import { z } from "zod";
import { crearSolicitudReserva } from "@/lib/api/mcp/tools";
import type { AttributionChannel } from "@/lib/attribution/derive-channel";

/**
 * Chat tool layer for creating a reservation (Chat Fase 2 · Incremento 3). Wraps
 * the existing MCP handler `crearSolicitudReserva` — which decodes the opaque
 * `quote` from cotizar, books in Localiza, inserts the row and fires the customer
 * notifications (idempotency already handled there: #99 proxy + #138 unique
 * index) — and unwraps its `CallToolResult` into a plain shape for the AI SDK
 * agent. Same seam as `runCotizar` in lib/chat/tools.ts.
 *
 * V1 (Inc. 3) scope: minimal customer data only (no add-ons, no flight). The
 * `franchise` is injected server-side from the request brand, never asked to the
 * LLM. Reservation creation is gated by CHAT_RESERVATIONS_ENABLED at the agent
 * layer; this runner always books when called.
 */

// Chat-facing input: the minimal fields the bot collects. The LLM picks the
// gama by its short `categoria` CODE — never the opaque quote: a base64url blob
// of hundreds of chars that the model corrupts when echoing it back, which made
// `decodeQuote` reject every booking. The server resolves categoria → quote from
// the last cotizar result (see lib/chat/agent.ts). `franchise` and `quote` are
// both injected server-side, so neither is in this schema.
export const crearReservaSchema = z.object({
  categoria: z
    .string()
    .min(1)
    .describe(
      "El CÓDIGO de gama que el cliente eligió (ej. 'C'), tal como lo devolvió " +
        "`cotizar` en el campo `categoria`. NO el quote.",
    ),
  fullname: z.string().min(1).describe("Nombre completo del cliente."),
  identification_type: z
    .string()
    .min(1)
    .describe("Tipo de documento: CC, CE o PA."),
  identification: z.string().min(1).describe("Número de documento."),
  email: z.string().min(1).describe("Correo del cliente."),
  phone: z.string().min(1).describe("Teléfono del cliente."),
});

export type CrearReservaArgs = z.infer<typeof crearReservaSchema>;

// Server-facing input for the runner: the agent injects the resolved `quote`
// (looked up from categoria) and the `franchise` before calling. Decoupled from
// the LLM schema on purpose — the model never supplies the quote.
export interface RunCrearReservaInput {
  quote: string;
  fullname: string;
  identification_type: string;
  identification: string;
  email: string;
  phone: string;
  franchise: string;
  // Issue #199 (Fase 0): channel override forwarded to the service. Set by
  // booking-core to 'chat-bot' (behind CHAT_ATTRIBUTION_BOT) so the reservation
  // is stamped as bot-created. Undefined → service derives from utm (none here).
  attribution_channel?: AttributionChannel;
}

export type CrearReservaResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

/** Create a reservation. `quote` and `franchise` are supplied by the caller. */
export async function runCrearReserva(
  args: RunCrearReservaInput,
): Promise<CrearReservaResult> {
  const result = await crearSolicitudReserva({
    quote: args.quote,
    fullname: args.fullname,
    identification_type: args.identification_type,
    identification: args.identification,
    email: args.email,
    phone: args.phone,
    franchise: args.franchise,
    attribution_channel: args.attribution_channel,
  });

  const text =
    result.content?.[0]?.type === "text" ? result.content[0].text : "";

  if (result.isError) {
    return {
      ok: false,
      message:
        text || "No pude crear la reserva. Intenta de nuevo más tarde.",
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      message: "No pude leer la confirmación de la reserva. Intenta de nuevo.",
    };
  }
}
