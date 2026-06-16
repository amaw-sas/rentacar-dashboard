import { z } from "zod";

/**
 * Opaque quote blob for the stateless MCP server (issue #72).
 *
 * The reservation flow is a mandatory two-step round-trip: `buscar_disponibilidad`
 * produces a quote, the AI client holds it, and `crear_solicitud_reserva` sends it
 * back. The server keeps NO session state — the full quotation context travels in
 * the tool arguments as a base64url(JSON) string. It is opaque to the AI (a token
 * to round-trip, not to edit) and self-contained (no server lookup to reconstitute).
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

/**
 * Spanish, user-facing message for any decode failure. The AI surfaces this to the
 * end user, so it must read naturally and never leak a stack trace or zod dump.
 */
const INVALID_QUOTE_MESSAGE =
  "La cotización es inválida o expiró. Vuelve a buscar disponibilidad para obtener una nueva.";

/**
 * Serialize a quote context to an opaque, deterministic string. Object key order
 * follows the `QuoteContext` shape (stable), so the same context always encodes to
 * the same blob — no `Date.now()`/random, safe for tests and caching.
 */
export function encodeQuote(ctx: QuoteContext): string {
  const validated = QuoteContext.parse(ctx);
  return Buffer.from(JSON.stringify(validated), "utf8").toString("base64url");
}

/**
 * Decode + validate an opaque quote blob back into a `QuoteContext`. Throws a
 * readable Spanish `Error` on any failure (missing, non-base64, non-JSON, or a
 * shape that fails zod) so the tool can map it to `isError` with a clean message.
 * Never reaches the proxy or the network.
 */
export function decodeQuote(blob: string | undefined | null): QuoteContext {
  if (!blob || typeof blob !== "string") {
    throw new Error(INVALID_QUOTE_MESSAGE);
  }

  let json: string;
  try {
    json = Buffer.from(blob, "base64url").toString("utf8");
  } catch {
    throw new Error(INVALID_QUOTE_MESSAGE);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(INVALID_QUOTE_MESSAGE);
  }

  const result = QuoteContext.safeParse(parsed);
  if (!result.success) {
    throw new Error(INVALID_QUOTE_MESSAGE);
  }
  return result.data;
}
