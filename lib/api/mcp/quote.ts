import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signed, expiring quote blob for the stateless MCP server (issue #72 + #172).
 *
 * The reservation flow is a mandatory two-step round-trip: `buscar_disponibilidad`
 * produces a quote, the AI client holds it, and `crear_solicitud_reserva` sends it
 * back. The server keeps NO session state — the full quotation context travels in
 * the tool arguments. It is opaque to the AI (a token to round-trip, not to edit)
 * and self-contained (no server lookup to reconstitute).
 *
 * Anti-abuse (issue #172): the MCP endpoint is ANONYMOUS (no OAuth, no x-api-key).
 * The quote IS the anti-tamper primitive — it is HMAC-SHA256 signed over the
 * payload (`MCP_QUOTE_SECRET`, which must be a strong random value >= 32 chars) and
 * carries `iat`/`exp`, so a client cannot forge a price or replay a stale quote.
 * The codec FAILS CLOSED on an unset/weak secret. Platform rate-limiting (Vercel
 * Firewall) is the other half; reservations land in `nueva` for operator review.
 *
 * Determinism: encode/decode use `Date.now()` BY DEFAULT (signing needs a
 * timestamp), so the same ctx no longer encodes to the same blob across calls.
 * Pass `issuedAtMs`/`nowMs` to pin the clock — tests do this for deterministic,
 * non-expiring round-trips.
 *
 * `referenceToken`/`rateQualifier` are REQUIRED (not optional): the MCP covers only
 * standard reservations, and a Localiza quote always carries both. Monthly
 * (`selected_days >= 30`) never produces a quote and is out of scope (design Non-goals).
 *
 * Prices are baked in at search time (`deriveStandardPricing`), matching the
 * client-trusted passthrough model both funnels already use. No customer data here.
 */
export const QuoteContext = z.object({
  pickupLocation: z.string().min(1), // Localiza branch code, already resolved
  returnLocation: z.string().min(1),
  pickupDateTime: z.string().min(1), // YYYY-MM-DDTHH:mm:ss
  returnDateTime: z.string().min(1),
  selected_days: z.number().int().positive(),
  categoryCode: z.string().min(1),
  referenceToken: z.string().min(1), // REQUIRED for standard
  rateQualifier: z.string().min(1), // REQUIRED for standard
  total_price: z.number(),
  total_price_to_pay: z.number(),
  tax_fee: z.number(),
  iva_fee: z.number(),
  coverage_days: z.number(),
  coverage_price: z.number(),
  return_fee: z.number(),
  extra_hours: z.number(),
  extra_hours_price: z.number(),
});

export type QuoteContext = z.infer<typeof QuoteContext>;

/** Default quote lifetime: 30 minutes. Tests override via `ttlSeconds`. */
export const QUOTE_TTL_SECONDS = 1800;

/**
 * Spanish, user-facing message for any decode failure. The AI surfaces this to the
 * end user, so it must read naturally and never leak a stack trace or zod dump.
 */
const INVALID_QUOTE_MESSAGE =
  "La cotización es inválida o expiró. Vuelve a buscar disponibilidad para obtener una nueva.";

/** Internal payload = QuoteContext fields PLUS issued-at / expiry (ms epoch). */
const SignedPayload = QuoteContext.extend({
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

/**
 * Minimum signing-secret length (after trimming). The HMAC is the ONLY anti-tamper
 * control on the anonymous endpoint, so a short/trivially-guessable key is treated
 * as a misconfiguration, not a usable secret.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Read the signing secret or fail closed. Unset, empty, whitespace-only, or shorter
 * than `MIN_SECRET_LENGTH` (after trimming) is a misconfiguration: we never sign or
 * accept quotes with a weak/absent key. Whitespace is trimmed so a trailing-newline
 * copy-paste of an otherwise-strong secret still works.
 */
function getSecret(): string {
  const secret = process.env.MCP_QUOTE_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `MCP_QUOTE_SECRET is not configured or too weak (need >= ${MIN_SECRET_LENGTH} chars)`,
    );
  }
  return secret;
}

/**
 * Assert the signing secret is configured and strong, throwing the same clear
 * internal error as `getSecret` otherwise. Exposed so an entry point (e.g.
 * `buscar_disponibilidad`) can fail loud on a misconfiguration BEFORE doing work,
 * instead of letting per-item encode failures masquerade as "no availability".
 */
export function assertQuoteSecretConfigured(): void {
  getSecret();
}

function base64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** HMAC-SHA256 of the (already base64url-encoded) payload segment, base64url'd. */
function sign(payloadB64: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(payloadB64).digest();
  return Buffer.from(mac).toString("base64url");
}

/**
 * Serialize a quote context to a signed, expiring blob:
 * `base64url(payloadJson) + "." + base64url(hmac)`.
 *
 * The payload is the validated `QuoteContext` plus `iat`/`exp`. FAILS CLOSED:
 * throws a clear internal error if `MCP_QUOTE_SECRET` is unset/empty/weak
 * (< 32 chars after trimming).
 *
 * `issuedAtMs` defaults to `Date.now()`; `ttlSeconds` defaults to
 * `QUOTE_TTL_SECONDS` (30 min). Pass both to get a deterministic blob.
 */
export function encodeQuote(
  ctx: QuoteContext,
  opts?: { issuedAtMs?: number; ttlSeconds?: number },
): string {
  const secret = getSecret();
  const validated = QuoteContext.parse(ctx);
  const iat = opts?.issuedAtMs ?? Date.now();
  const ttl = opts?.ttlSeconds ?? QUOTE_TTL_SECONDS;
  const exp = iat + ttl * 1000;

  const payloadB64 = base64urlEncode(JSON.stringify({ ...validated, iat, exp }));
  const sigB64 = sign(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Decode + verify + un-expire a signed quote blob back into a `QuoteContext`.
 * Throws a readable Spanish `Error` (`INVALID_QUOTE_MESSAGE`) on EVERY failure —
 * missing/empty, malformed wire format, bad signature, bad base64/JSON, expired,
 * or bad shape — never a stack/zod dump. Never reaches the proxy or the network.
 *
 * The returned object is EXACTLY the `QuoteContext` (iat/exp stripped), so
 * `decodeQuote(encodeQuote(ctx))` deep-equals `ctx`.
 *
 * `nowMs` defaults to `Date.now()`; tests pin it to control expiry.
 */
export function decodeQuote(
  blob: string | undefined | null,
  opts?: { nowMs?: number },
): QuoteContext {
  try {
    if (!blob || typeof blob !== "string") throw new Error();

    // Per the #172 contract, a missing/empty MCP_QUOTE_SECRET FAILS CLOSED as the
    // Spanish INVALID_QUOTE_MESSAGE (not an internal error), so getSecret() throws
    // INSIDE the catch-all on purpose — the AI surfaces a clean message either way.
    const secret = getSecret();
    const nowMs = opts?.nowMs ?? Date.now();

    // Wire format: exactly two "."-separated segments.
    const parts = blob.split(".");
    if (parts.length !== 2) throw new Error();
    const [payloadB64, sigB64] = parts;

    // Constant-time signature comparison. Guard length first — timingSafeEqual
    // throws on a length mismatch, which would itself leak a timing signal.
    const expectedSig = Buffer.from(sign(payloadB64, secret), "base64url");
    const providedSig = Buffer.from(sigB64, "base64url");
    if (
      expectedSig.length !== providedSig.length ||
      !timingSafeEqual(expectedSig, providedSig)
    ) {
      throw new Error();
    }

    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);

    const signed = SignedPayload.safeParse(parsed);
    if (!signed.success) throw new Error();

    // Expiry: `exp` is exclusive — reject once the clock reaches `exp`.
    if (nowMs >= signed.data.exp) throw new Error();

    // Strip iat/exp and return EXACTLY the QuoteContext.
    const { iat: _iat, exp: _exp, ...ctx } = signed.data;
    void _iat;
    void _exp;
    return QuoteContext.parse(ctx);
  } catch {
    throw new Error(INVALID_QUOTE_MESSAGE);
  }
}
