import { describe, it, expect } from "vitest";
import { encodeQuote, decodeQuote, type QuoteContext } from "@/lib/api/mcp/quote";

// Issue #72 Step 4: the opaque quote blob carries the full quotation context
// between the two MCP tools (stateless server). These tests encode holdout
// scenarios SCEN-101..104.

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

function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

describe("quote codec (issue #72 Step 4)", () => {
  // SCEN-101 — round-trip is deep-equal, encode is deterministic.
  it("SCEN-101: round-trips a valid quote identically and deterministically", () => {
    const blob = encodeQuote(VALID_CTX);
    expect(decodeQuote(blob)).toEqual(VALID_CTX);
    // Determinism: same context → same blob (no Date.now()/random).
    expect(encodeQuote(VALID_CTX)).toBe(blob);
  });

  // SCEN-102 — absent/empty blob → readable ES error, no proxy/network.
  it("SCEN-102: rejects an absent or empty blob with a Spanish message", () => {
    expect(() => decodeQuote("")).toThrow(/cotización/i);
    expect(() => decodeQuote(undefined)).toThrow(/cotización/i);
    expect(() => decodeQuote(null)).toThrow(/cotización/i);
  });

  // SCEN-103 — corrupt base64/JSON → readable ES error, no stack leak.
  it("SCEN-103: rejects corrupt base64/JSON with a Spanish message", () => {
    // base64url of a non-JSON string → JSON.parse fails.
    expect(() => decodeQuote(base64url("no json válido"))).toThrow(/cotización/i);
    // Garbage that decodes to non-JSON bytes.
    expect(() => decodeQuote("@@@not-base64@@@")).toThrow(/cotización/i);
    // The message is the clean ES copy, never a raw parser/stack dump.
    let err: Error | undefined;
    try {
      decodeQuote(base64url("{bad json"));
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/inválida o expiró/i);
    expect(err?.message).not.toMatch(/JSON|SyntaxError|zod|undefined/);
  });

  // SCEN-104 — incomplete/altered shape → zod rejects, readable ES error.
  it("SCEN-104: rejects an incomplete or altered shape", () => {
    const missingToken: Partial<QuoteContext> = { ...VALID_CTX };
    delete missingToken.referenceToken;
    expect(() => decodeQuote(base64url(JSON.stringify(missingToken)))).toThrow(
      /cotización/i,
    );

    const badDays = base64url(JSON.stringify({ ...VALID_CTX, selected_days: 0 }));
    expect(() => decodeQuote(badDays)).toThrow(/cotización/i);

    const badPrice = base64url(
      JSON.stringify({ ...VALID_CTX, total_price: "105" }),
    );
    expect(() => decodeQuote(badPrice)).toThrow(/cotización/i);
  });
});
