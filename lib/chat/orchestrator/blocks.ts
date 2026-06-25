import { findGama, type QuoteTable } from "./quote-service";
import type { ClienteSlots, ConversationState, Slots } from "./slots";

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

/** Display name of a brand (for greetings and the free-form prompt). */
export function brandName(brand: string): string {
  return BRAND_NAMES[brand] ?? "nuestra marca";
}

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

// ---------------------------------------------------------------------------
// Booking phase (Etapa 3) — code owns the close. All PURE, all warm-but-short ES.
// ---------------------------------------------------------------------------

const COP = new Intl.NumberFormat("es-CO");
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** "2026-07-01" → "1 de jul"; null when unparseable. */
function fechaCorta(ymd?: string): string | null {
  if (!ymd) return null;
  const [, m, d] = ymd.split("-");
  const mi = Number(m) - 1;
  const di = Number(d);
  if (!Number.isInteger(mi) || mi < 0 || mi > 11 || !di) return null;
  return `${di} de ${MESES[mi]}`;
}

/** "14:00" → "2 pm"; "12:00" → "mediodía"; null when unparseable. */
function horaCorta(hm?: string): string | null {
  if (!hm) return null;
  const [hh, mm] = hm.split(":").map(Number);
  if (!Number.isInteger(hh)) return null;
  const min = Number.isInteger(mm) ? mm : 0;
  if (hh === 12 && min === 0) return "mediodía";
  if (hh === 0 && min === 0) return "medianoche";
  const ampm = hh < 12 ? "am" : "pm";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return min ? `${h12}:${String(min).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

/** "del 1 de jul 8 am al 4 de jul 8 am" (hours optional); null without both dates. */
function periodoCorto(s: Slots): string | null {
  const fr = fechaCorta(s.fecha_recogida);
  const fd = fechaCorta(s.fecha_devolucion);
  if (!fr || !fd) return null;
  const hr = horaCorta(s.hora_recogida);
  const hd = horaCorta(s.hora_devolucion);
  const from = hr ? `${fr} ${hr}` : fr;
  const to = hd ? `${fd} ${hd}` : fd;
  return `del ${from} al ${to}`;
}

function capitalize(x: string): string {
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
}

/**
 * The next customer datum to ask for, in order (fullname → document → email →
 * phone); null when every field is present. One warm question at a time on re-ask.
 */
export function nextCustomerQuestion(cliente: ClienteSlots): string | null {
  if (!cliente.fullname) return "Perfecto. ¿Me compartes tu nombre completo?";
  if (!cliente.identification_type || !cliente.identification) {
    return "¿Cuál es tu tipo y número de documento? (CC, CE o PA)";
  }
  if (!cliente.email) return "¿A qué correo te envío la confirmación?";
  if (!cliente.phone) return "Por último, ¿cuál es tu número de teléfono?";
  return null;
}

/** Short list of the quoted gamas — used ONLY when the client must pick a valid one
 * (named an invalid gama, or asked "which one?"). It is NOT a per-turn nudge: re-listing
 * the whole table every off-funnel turn is the repetition bug — use {@link gamaNudgeLine}. */
export function gamaOptionsLine(table: QuoteTable): string {
  const list = table.filas.map((f) => `Gama ${f.categoria}`).join(", ");
  return `¿Con cuál gama seguimos? Tenemos: ${list}.`;
}

/**
 * Listless nudge back to the gama choice, for AFTER an off-funnel answer while a quote
 * is on the table. The quote table already lists every gama, so re-pasting all the codes
 * each turn is pure noise (the repetition the user reported). One short question instead.
 */
export function gamaNudgeLine(): string {
  return "¿Con cuál gama te quedas?";
}

/**
 * Concrete extra-hour answer for ONE gama, fed by a re-quote's per-hour `precio_hora_extra`
 * (Localiza only returns the charge when the quote actually spans extra hours, so the
 * orchestrator re-quotes with a later return to read it). Whole COP.
 */
export function horaExtraLine(
  gamaCode: string,
  ciudad: string | undefined,
  precioHoraExtra: number,
): string {
  const donde = ciudad ? ` en ${capitalize(ciudad)}` : "";
  return (
    `Para la Gama ${gamaCode}${donde}, cada hora extra cuesta **$${COP.format(precioHoraExtra)}** ` +
    `(aplica si devuelves después de la hora pactada; desde la 4.ª hora ya se cobra un día completo).`
  );
}

/**
 * One-time booking summary before the final confirmation. NEVER shows addresses,
 * maps or the provider; the sede code is intentionally omitted (the city already
 * locates it). Ends with the explicit confirmation question.
 */
export function bookingSummaryBlock(state: ConversationState): string {
  const s = state.slots;
  const row =
    state.lastQuote && s.gama_elegida
      ? findGama(state.lastQuote, s.gama_elegida)
      : undefined;

  // `descripcion` already starts with "Gama X" — use it verbatim (no "Gama CX gama cx…").
  const gama = row ? row.descripcion : "la gama elegida";
  const dias = row?.dias ?? state.lastQuote?.dias;
  const periodo = periodoCorto(s);

  const parts: string[] = [`Para cerrar, te confirmo: ${gama}`];
  if (s.ciudad) parts.push(`en ${capitalize(s.ciudad)}`);
  if (periodo) parts.push(periodo);
  if (dias) parts.push(`${dias} día${dias === 1 ? "" : "s"}`);

  let line = `${parts.join(", ")}.`;
  if (row) line += ` Total **$${COP.format(row.precioTotal)}**.`;
  if (s.cliente.fullname) line += ` A nombre de ${s.cliente.fullname}.`;
  line += " ¿Confirmo la reserva?";
  return line;
}

/** Success line after a real booking. Includes the request number when present. */
export function bookingConfirmedLine(data: unknown): string {
  const d = (data ?? {}) as {
    numero_solicitud?: unknown;
    numeroSolicitud?: unknown;
  };
  const code =
    typeof d.numero_solicitud === "string"
      ? d.numero_solicitud
      : typeof d.numeroSolicitud === "string"
        ? d.numeroSolicitud
        : null;
  const head = code
    ? `¡Listo! Tu reserva quedó confirmada con el número **${code}**.`
    : "¡Listo! Tu reserva quedó confirmada.";
  return `${head} Te envié todos los detalles a tu correo y WhatsApp. Cualquier cosa, aquí estoy.`;
}
