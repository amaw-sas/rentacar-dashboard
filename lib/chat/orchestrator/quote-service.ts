import { runCotizar, type CotizarArgs } from "@/lib/chat/tools";

/**
 * Orchestrator quote layer (Rediseño híbrido · Etapa 0). A THIN normalizer over
 * the existing `runCotizar` (which wraps Localiza via the MCP `buscarDisponibilidad`
 * tool). It does NOT re-implement pricing or touch the signed quote blob — it only
 * reshapes the tool's `categorias` into a flat `QuoteTable` the deterministic
 * orchestrator and the renderer consume directly, so the LLM never formats prices.
 *
 * `precioHoraExtra` is now surfaced (Etapa 0 exposed it in the tool output) so the
 * bot can answer "¿cuánto vale una hora extra?" without re-quoting.
 */

/** One quoted gama, flattened from the tool's `categorias`. */
export interface QuoteRow {
  /** Gama code, e.g. "C". */
  categoria: string;
  descripcion: string;
  dias: number;
  /** All-in total to pay in COP (includes IVA, taxes, basic insurance, extra hours). */
  precioTotal: number;
  /** Extra-hour charge already baked into precioTotal; 0 when return ≤ pickup time. */
  precioHoraExtra: number;
  horasExtra: number;
  /** Opaque HMAC-signed quote blob — passed verbatim to `crear_reserva`, never shown. */
  quote: string;
}

export interface QuoteTable {
  /** Localiza branch code the quote resolved to. */
  sede: string;
  dias: number;
  filas: QuoteRow[];
}

export type QuoteTableResult =
  | { ok: true; table: QuoteTable }
  | { ok: false; message: string };

interface RawCategoria {
  categoria?: unknown;
  descripcion?: unknown;
  dias?: unknown;
  precio_a_pagar?: unknown;
  precio_total?: unknown;
  precio_hora_extra?: unknown;
  horas_extra?: unknown;
  quote?: unknown;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
/** Prices display in whole COP — the provider sends sub-peso decimals we round off. */
const pesos = (v: unknown): number => Math.round(num(v));

/**
 * Quote a city/dates/sede and return a flat table. Relays the same human ES error
 * message `runCotizar` produces (city-not-found with valid cities, no availability,
 * bad dates) so the orchestrator can show it as-is.
 */
export async function getQuoteTable(
  args: CotizarArgs,
): Promise<QuoteTableResult> {
  const result = await runCotizar(args);
  if (!result.ok) return { ok: false, message: result.message };

  const data = result.data as {
    sede?: unknown;
    dias?: unknown;
    categorias?: unknown;
  };
  const rawList = Array.isArray(data.categorias)
    ? (data.categorias as RawCategoria[])
    : [];

  const filas: QuoteRow[] = rawList
    .filter(
      (c) => typeof c.categoria === "string" && typeof c.quote === "string",
    )
    .map((c) => ({
      categoria: c.categoria as string,
      descripcion:
        typeof c.descripcion === "string"
          ? c.descripcion
          : (c.categoria as string),
      dias: num(c.dias),
      precioTotal: pesos(c.precio_a_pagar ?? c.precio_total),
      precioHoraExtra: pesos(c.precio_hora_extra),
      horasExtra: num(c.horas_extra),
      quote: c.quote as string,
    }));

  if (filas.length === 0) {
    return {
      ok: false,
      message: "No hay disponibilidad para esas fechas. Prueba con otras.",
    };
  }

  return {
    ok: true,
    table: { sede: String(data.sede ?? ""), dias: num(data.dias), filas },
  };
}

/** Look up a single quoted gama by its code (for "reserva la C" / show one price). */
export function findGama(
  table: QuoteTable,
  categoria: string,
): QuoteRow | undefined {
  const target = categoria.trim().toLowerCase();
  return table.filas.find((f) => f.categoria.toLowerCase() === target);
}
