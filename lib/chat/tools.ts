import { z } from "zod";
import {
  buscarDisponibilidad,
  buscarDisponibilidadInputSchema,
} from "@/lib/api/mcp/tools";

/**
 * Chatbot tool layer (V1). Wraps the existing MCP tool `buscarDisponibilidad`
 * (which already accepts human args — city by name, dates — and orchestrates
 * directory resolution → Localiza quote → opaque quote blob) and unwraps its
 * MCP `CallToolResult` into a plain shape the AI SDK agent can use.
 *
 * Design (plan Opción A): reuse `buscarDisponibilidad` as-is rather than
 * refactoring a shared core, to avoid touching the issue-#72 MCP route and its
 * test. The only seam is unwrapping `content[0].text`.
 *
 * V1 exposes quoting only — the bot quotes and pushes the customer to a reserve
 * LINK; it does NOT create reservations (no `crearSolicitudReserva` here), which
 * keeps the public endpoint side-effect free.
 */

// Reuse the exact Zod shape the MCP tool already declares — single source of
// truth for the cotizar input contract.
export const cotizarSchema = z.object(buscarDisponibilidadInputSchema);

export type CotizarArgs = z.infer<typeof cotizarSchema>;

export type CotizarResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

/**
 * Run a quote. Returns a discriminated result: `ok:true` with the parsed quote
 * JSON, or `ok:false` with the human ES message the LLM relays verbatim
 * (city-not-found — which already lists valid cities, no availability, bad dates,
 * Localiza errors). Never throws for the expected error paths; the agent always
 * gets something it can say back to the user.
 */
export async function runCotizar(args: CotizarArgs): Promise<CotizarResult> {
  const result = await buscarDisponibilidad(args);

  const text =
    result.content?.[0]?.type === "text" ? result.content[0].text : "";

  if (result.isError) {
    return {
      ok: false,
      message:
        text || "No pude consultar disponibilidad. Intenta de nuevo más tarde.",
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      message: "No pude leer la cotización. Intenta de nuevo más tarde.",
    };
  }
}
