import type { QuoteTable } from "./quote-service";
import type { Slots } from "./slots";

/**
 * Fixed conversation blocks (Rediseño híbrido · Etapa 2). PURE functions that build
 * the deterministic, code-owned parts of a turn — greeting, requisitos, the quote
 * table payload, and the next funnel question. Because these come from code (emitted
 * once, guarded by flags), the LLM never holds them in its output and CANNOT repeat
 * them. This is what kills the repetition class of bugs.
 */

const BRAND_NAMES: Record<string, string> = {
  alquilatucarro: "AlquilaTuCarro",
  alquilame: "Alquílame",
  alquicarros: "AlquiCarros",
};
const ADVISOR = "Valeria";

function bogotaHour(now: Date): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(hh);
}

/** Time-aware greeting. Emitted ONCE (guarded by flags.greeted). */
export function greetingBlock(brand: string, now: Date): string {
  const h = bogotaHour(now);
  const saludo =
    h < 12 ? "buenos días" : h < 19 ? "buenas tardes" : "buenas noches";
  const name = BRAND_NAMES[brand] ?? "nuestra marca";
  return `Hola, ${saludo}. Soy ${ADVISOR}, la asesora virtual de ${name}, atenta para ayudarte.`;
}

/** Canonical requirements block. Emitted ONCE (guarded by flags.requisitos_shown). */
export const REQUISITOS_BLOCK = [
  "**NUESTROS REQUISITOS**",
  "- Tarjeta de crédito para el pago en la sede (Visa, MasterCard o American Express).",
  "- Documento de Identidad (físico)",
  "- Licencia Vigente (solo física)",
  "- Realizar una reserva previa por este medio.",
].join("\n");

export function requisitosBlock(): string {
  return REQUISITOS_BLOCK;
}

/** Payload for the `data-quoteTable` part the page renders (code formats prices, not the LLM). */
export interface QuoteTablePart {
  sede: string;
  dias: number;
  filas: Array<{
    categoria: string;
    descripcion: string;
    precioTotal: number;
    horasExtra: number;
    precioHoraExtra: number;
  }>;
}

export function quoteTableData(table: QuoteTable): QuoteTablePart {
  return {
    sede: table.sede,
    dias: table.dias,
    filas: table.filas.map((f) => ({
      categoria: f.categoria,
      descripcion: f.descripcion,
      precioTotal: f.precioTotal,
      horasExtra: f.horasExtra,
      precioHoraExtra: f.precioHoraExtra,
    })),
  };
}

/** Signature of the quote-defining slots — detects when a fresh cotizar is needed. */
export function quoteSignature(s: Slots): string {
  return [
    s.ciudad,
    s.sede,
    s.fecha_recogida,
    s.fecha_devolucion,
    s.hora_recogida,
    s.hora_devolucion,
  ]
    .map((x) => (x ?? "").toLowerCase())
    .join("|");
}

/** Whether ciudad + both dates are known (enough to cotizar). */
export function canQuote(s: Slots): boolean {
  return Boolean(s.ciudad && s.fecha_recogida && s.fecha_devolucion);
}

/** Deterministic question for the next missing quote slot; null when complete. */
export function nextQuoteQuestion(s: Slots): string | null {
  if (!s.ciudad) return "¿En qué ciudad necesitas el carro?";
  if (!s.fecha_recogida) return "¿Para qué fecha lo necesitas (recogida)?";
  if (!s.fecha_devolucion) return "¿Y qué día lo devolverías?";
  return null;
}

/** Deterministic closing line after a quote (no "apartar" promise until booking is wired). */
export function quoteClosingLine(): string {
  return "¿Con cuál gama te gustaría seguir?";
}
