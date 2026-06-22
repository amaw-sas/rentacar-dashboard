import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import {
  encodeQuote,
  decodeQuote,
  assertQuoteSecretConfigured,
  QUOTE_TTL_SECONDS,
  type QuoteContext,
} from "@/lib/api/mcp/quote";

// Issue #72 Step 4 + issue #172: the opaque quote blob carries the full
// quotation context between the two MCP tools (stateless server). Issue #172
// drops OAuth — the endpoint is anonymous — so the quote itself becomes the
// anti-abuse primitive: HMAC-signed (tamper-proof) and expiring (TTL).
// These tests encode holdout scenarios SCEN-101..104 + SCEN-130..135 (the #172
// signed/expiring band — SCEN-120..123 are already taken by tools.test.ts/#72).

// >= 32 chars: the production guard rejects anything shorter (anti-weak-secret).
const SECRET = "test-quote-secret-0123456789abcdef";

const VALID_CTX: QuoteContext = {
  pickupLocation: "AABOG01",
  returnLocation: "AABOG01",
  pickupDateTime: "2026-07-01T10:00:00",
  returnDateTime: "2026-07-05T10:00:00",
  selected_days: 4,
  categoryCode: "C",
  referenceToken: "tok-abc",
  rateQualifier: "RQ1",
  total_price: 105,
  total_price_to_pay: 119,
  tax_fee: 5,
  iva_fee: 19,
  coverage_days: 0,
  coverage_price: 0,
  return_fee: 0,
  extra_hours: 0,
  extra_hours_price: 0,
};

// A fixed reference instant so encode/decode are deterministic in tests.
const FIXED_IAT = 1_700_000_000_000; // ms epoch
const WITHIN_TTL = FIXED_IAT + 60_000; // 1 min later — inside the 30-min window

function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

describe("quote codec (issue #72 Step 4 + issue #172 signed/expiring)", () => {
  let ORIGINAL: string | undefined;

  beforeAll(() => {
    ORIGINAL = process.env.MCP_QUOTE_SECRET;
    process.env.MCP_QUOTE_SECRET = SECRET;
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_QUOTE_SECRET;
    else process.env.MCP_QUOTE_SECRET = ORIGINAL;
  });

  // SCEN-101 — round-trip is deep-equal (no iat/exp/sig leaking), encode is
  // deterministic given a fixed issuedAtMs.
  it("SCEN-101: round-trips a valid quote identically and deterministically", () => {
    const blob = encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT });
    // Round-trip yields EXACTLY the ctx — no iat/exp leak.
    expect(decodeQuote(blob, { nowMs: WITHIN_TTL })).toEqual(VALID_CTX);
    // Determinism: same ctx + same issuedAtMs → byte-identical blob.
    expect(encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT })).toBe(blob);
  });

  // SCEN-102 — absent/empty blob → readable ES error, no proxy/network.
  it("SCEN-102: rejects an absent or empty blob with a Spanish message", () => {
    expect(() => decodeQuote("")).toThrow(/cotización/i);
    expect(() => decodeQuote(undefined)).toThrow(/cotización/i);
    expect(() => decodeQuote(null)).toThrow(/cotización/i);
  });

  // SCEN-103 — corrupt base64/JSON / wrong format → readable ES error, no leak.
  it("SCEN-103: rejects corrupt base64/JSON with a Spanish message", () => {
    // Not 2 parts (no "." separator) → format rejected.
    expect(() => decodeQuote(base64url("no json válido"))).toThrow(/cotización/i);
    // Garbage that isn't a valid 2-part signed blob.
    expect(() => decodeQuote("@@@not-base64@@@")).toThrow(/cotización/i);
    // The message is the clean ES copy, never a raw parser/stack/zod dump.
    let err: Error | undefined;
    try {
      decodeQuote(base64url("{bad json"));
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/inválida o expiró/i);
    expect(err?.message).not.toMatch(/JSON|SyntaxError|zod|undefined|hmac/i);
  });

  // SCEN-104 — incomplete/altered shape → rejected, readable ES error. A
  // tampered shape would also fail the signature, but to isolate the shape
  // check we sign the malformed payloads with the real secret here.
  it("SCEN-104: rejects an incomplete or altered shape", () => {
    const missingToken: Record<string, unknown> = { ...VALID_CTX };
    delete missingToken.referenceToken;
    expect(() => decodeQuote(signRaw(missingToken, SECRET))).toThrow(/cotización/i);

    const badDays = signRaw({ ...VALID_CTX, selected_days: 0 }, SECRET);
    expect(() => decodeQuote(badDays)).toThrow(/cotización/i);

    const badPrice = signRaw({ ...VALID_CTX, total_price: "105" }, SECRET);
    expect(() => decodeQuote(badPrice)).toThrow(/cotización/i);
  });

  // SCEN-130 — a tampered (re-priced) payload whose signature is not re-computed
  // is rejected. Mutating the price after signing breaks the HMAC.
  it("SCEN-130: rejects a signed quote whose payload was tampered with", () => {
    const blob = encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT });
    const [payloadB64, sigB64] = blob.split(".");
    // Decode the payload, drop the price to ~zero, re-encode the payload only —
    // WITHOUT re-signing. The old signature no longer matches.
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
    payload.total_price_to_pay = 1;
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify(payload),
      "utf8",
    ).toString("base64url");
    const forged = `${tamperedPayloadB64}.${sigB64}`;
    expect(() => decodeQuote(forged, { nowMs: WITHIN_TTL })).toThrow(/cotización/i);

    // Also: flipping a single char of the payload segment breaks it.
    const flipped = `${flipOneChar(payloadB64)}.${sigB64}`;
    expect(() => decodeQuote(flipped, { nowMs: WITHIN_TTL })).toThrow(
      /cotización/i,
    );
  });

  // SCEN-131 — expiry boundary. `exp` is EXCLUSIVE: a quote is rejected the
  // instant the clock reaches exp (nowMs === exp), valid at exp - 1.
  it("SCEN-131: rejects an expired quote, with exp treated as exclusive", () => {
    const blob = encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT });
    const exp = FIXED_IAT + QUOTE_TTL_SECONDS * 1000;

    // Well past expiry → rejected.
    expect(() => decodeQuote(blob, { nowMs: exp + 1000 })).toThrow(/cotización/i);

    // Exactly at exp → rejected (the clock has reached expiry).
    expect(() => decodeQuote(blob, { nowMs: exp })).toThrow(/cotización/i);

    // One ms before exp → still valid.
    expect(decodeQuote(blob, { nowMs: exp - 1 })).toEqual(VALID_CTX);
  });

  // SCEN-132 — a quote signed with a DIFFERENT secret is rejected (forged sig).
  it("SCEN-132: rejects a quote signed with the wrong secret", () => {
    const forged = signRaw(
      { ...VALID_CTX, iat: FIXED_IAT, exp: FIXED_IAT + QUOTE_TTL_SECONDS * 1000 },
      "a-completely-different-secret",
      { alreadyTimestamped: true },
    );
    expect(() => decodeQuote(forged, { nowMs: WITHIN_TTL })).toThrow(/cotización/i);
  });

  // SCEN-133 — a valid, non-expired, correctly-signed quote round-trips to the
  // ctx (positive control alongside the negatives above).
  it("SCEN-133: a valid non-expired signed quote round-trips to the ctx", () => {
    const blob = encodeQuote(VALID_CTX, {
      issuedAtMs: FIXED_IAT,
      ttlSeconds: 600,
    });
    expect(decodeQuote(blob, { nowMs: FIXED_IAT + 599_000 })).toEqual(VALID_CTX);
  });

  // SCEN-134 — fail closed on missing/empty secret. encode throws a clear
  // internal error (caller logs/skips); decode throws the Spanish message so the
  // end user never sees a stack trace.
  it("SCEN-134: fails closed when MCP_QUOTE_SECRET is unset", () => {
    const saved = process.env.MCP_QUOTE_SECRET;
    try {
      delete process.env.MCP_QUOTE_SECRET;
      expect(() => encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT })).toThrow(
        /MCP_QUOTE_SECRET/,
      );
      // A blob that was valid under the secret is now undecodable → Spanish copy.
      process.env.MCP_QUOTE_SECRET = SECRET;
      const blob = encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT });
      delete process.env.MCP_QUOTE_SECRET;
      let err: Error | undefined;
      try {
        decodeQuote(blob, { nowMs: WITHIN_TTL });
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toMatch(/inválida o expiró/i);
      expect(err?.message).not.toMatch(/MCP_QUOTE_SECRET/);

      // Empty string is treated the same as unset.
      process.env.MCP_QUOTE_SECRET = "";
      expect(() => encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT })).toThrow(
        /MCP_QUOTE_SECRET/,
      );
      expect(() => decodeQuote(blob, { nowMs: WITHIN_TTL })).toThrow(
        /inválida o expiró/i,
      );
    } finally {
      if (saved === undefined) delete process.env.MCP_QUOTE_SECRET;
      else process.env.MCP_QUOTE_SECRET = saved;
    }
  });

  // SCEN-135 — fail closed on a WEAK secret. A whitespace-only value (truthy but
  // useless) and a non-blank value shorter than 32 chars after trimming must both
  // be rejected: a trivially-guessable key would defeat the only anti-tamper
  // control on an anonymous endpoint. encode + assert throw the internal error;
  // decode throws the Spanish message.
  it("SCEN-135: fails closed when MCP_QUOTE_SECRET is whitespace-only or too short", () => {
    const saved = process.env.MCP_QUOTE_SECRET;
    // A blob signed under the strong secret, to probe decode under a weak one.
    process.env.MCP_QUOTE_SECRET = SECRET;
    const blob = encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT });
    try {
      for (const weak of ["   ", "short", "0123456789abcdef0123456789abcde"]) {
        // 31 chars                                  ^ one short of 32
        process.env.MCP_QUOTE_SECRET = weak;
        expect(() => encodeQuote(VALID_CTX, { issuedAtMs: FIXED_IAT })).toThrow(
          /MCP_QUOTE_SECRET/,
        );
        expect(() => assertQuoteSecretConfigured()).toThrow(/MCP_QUOTE_SECRET/);
        // decode never leaks the internal reason to the end user.
        let err: Error | undefined;
        try {
          decodeQuote(blob, { nowMs: WITHIN_TTL });
        } catch (e) {
          err = e as Error;
        }
        expect(err?.message).toMatch(/inválida o expiró/i);
        expect(err?.message).not.toMatch(/MCP_QUOTE_SECRET/);
      }

      // Exactly 32 chars (trimmed) is accepted.
      process.env.MCP_QUOTE_SECRET = "0123456789abcdef0123456789abcdef"; // 32
      expect(() => assertQuoteSecretConfigured()).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.MCP_QUOTE_SECRET;
      else process.env.MCP_QUOTE_SECRET = saved;
    }
  });
});

/**
 * Test helper — produce a wire blob (`payloadB64.sigB64`) directly so tests can
 * forge payloads (bad shape, wrong secret) that the production encoder would
 * reject. Mirrors the production wire format exactly.
 */
function signRaw(
  obj: Record<string, unknown>,
  secret: string,
  opts?: { alreadyTimestamped?: boolean },
): string {
  const payload = opts?.alreadyTimestamped
    ? obj
    : { ...obj, iat: FIXED_IAT, exp: FIXED_IAT + QUOTE_TTL_SECONDS * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = Buffer.from(sig).toString("base64url");
  return `${payloadB64}.${sigB64}`;
}

function flipOneChar(b64: string): string {
  const i = Math.floor(b64.length / 2);
  const c = b64[i];
  const replacement = c === "A" ? "B" : "A";
  return b64.slice(0, i) + replacement + b64.slice(i + 1);
}
