import { z } from "zod";
import { crearSolicitudReserva } from "@/lib/api/mcp/tools";

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

// Chat-facing input: the minimal fields the bot collects. `franchise` is added
// server-side by the agent, so it is NOT in this schema.
export const crearReservaSchema = z.object({
  quote: z
    .string()
    .min(1)
    .describe(
      "El 'quote' opaco que devolvió `cotizar` para la gama que el cliente eligió.",
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

export type CrearReservaResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

/** Create a reservation. `franchise` is supplied by the caller (the brand). */
export async function runCrearReserva(
  args: CrearReservaArgs & { franchise: string },
): Promise<CrearReservaResult> {
  const result = await crearSolicitudReserva({
    quote: args.quote,
    fullname: args.fullname,
    identification_type: args.identification_type,
    identification: args.identification,
    email: args.email,
    phone: args.phone,
    franchise: args.franchise,
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
