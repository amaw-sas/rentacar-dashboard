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

/**
 * Core signature = ciudad + fechas ONLY (no sede, no horas). Compared against the stored
 * core signature to tell a MINOR change (sede or pickup/return hour) apart from a real
 * re-quote (different city or dates). A minor change refreshes the quote silently and only
 * re-shows the table if the price actually moved — it must NOT re-paste the whole table or
 * reset the funnel on every sede/hour tweak (the repetition the customer hit while adjusting
 * the pickup time). A genuine ciudad/fecha change still triggers a full visible re-quote.
 */
export function quoteCoreSignature(s: Slots): string {
  return [s.ciudad, s.fecha_recogida, s.fecha_devolucion]
    .map((x) => (x ?? "").toLowerCase())
    .join("|");
}

/**
 * True when two quote tables price every gama identically — same gamas, same totals AND
 * same extra-hour rate. (The hora-extra figure is shown on the same card, so a sede that
 * changes only it must still re-show the table, not be treated as "price-equal".)
 */
export function quotesPriceEqual(a: QuoteTable, b: QuoteTable): boolean {
  if (a.filas.length !== b.filas.length) return false;
  const key = (f: QuoteTable["filas"][number]) =>
    `${f.precioTotal}|${f.precioHoraExtra}`;
  const priced = new Map(a.filas.map((f) => [f.categoria, key(f)]));
  return b.filas.every((f) => priced.get(f.categoria) === key(f));
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

/** Which quote slot is missing next (drives the funnel question). null when complete. */
export type QuoteSlot = "ciudad" | "fecha_recogida" | "fecha_devolucion";
export function nextQuoteSlot(s: Slots): QuoteSlot | null {
  if (!s.ciudad) return "ciudad";
  if (!s.fecha_recogida) return "fecha_recogida";
  if (!s.fecha_devolucion) return "fecha_devolucion";
  return null;
}

/**
 * Question for a missing quote slot, ESCALATING by how many times we've already asked for it
 * (`attempt`, 1-based) so the same line is never repeated verbatim — the dominant
 * repeated_question_verbatim failure. attempt 1 = plain ask; 2 = warmer + example; 3+ = explicit
 * format + an advisor offer (the customer is clearly stuck or the extractor can't parse them).
 */
export function quoteSlotQuestion(slot: QuoteSlot, attempt: number): string {
  const stuck = attempt >= 3;
  switch (slot) {
    case "ciudad":
      if (stuck)
        return "Disculpa que insista 🙏 Solo necesito el nombre de la ciudad, escríbelo tal cual (ej.: Bogotá). Si prefieres, te paso con un asesor que te ayuda enseguida.";
      return attempt >= 2
        ? "Para cotizarte solo me falta la ciudad — por ejemplo Bogotá, Medellín o Cali. ¿En cuál la necesitas?"
        : "¿En qué ciudad necesitas el carro?";
    case "fecha_recogida":
      if (stuck)
        return "Para avanzar necesito el día de RECOGIDA en fecha (ej.: 5 de julio). ¿Me lo confirmas? Si no, con gusto te paso con un asesor.";
      return attempt >= 2
        ? "¿Qué día lo recogerías? Puede ser algo como “5 de julio” o “este sábado”."
        : "¿Para qué fecha lo necesitas (recogida)?";
    case "fecha_devolucion":
      if (stuck)
        return "Solo me falta el día de DEVOLUCIÓN (ej.: 8 de julio) y te cotizo al instante. ¿Me lo das? o si prefieres te paso con un asesor.";
      return attempt >= 2
        ? "¿Y qué día lo devolverías? Con eso te paso el precio de una."
        : "¿Y qué día lo devolverías?";
  }
}

/**
 * Never leak a raw provider error to the customer. Clean Spanish messages (no availability,
 * past date, out-of-hours) pass through; anything that looks technical (XML/SOAP envelope,
 * HTTP code, exception/stack, a URL, or an over-long blob) is replaced with a safe line.
 */
const SAFE_QUOTE_FALLBACK =
  "No pude calcular el precio en este momento. ¿Probamos con otra fecha o sede? Si prefieres, te paso con un asesor.";
export function safeQuoteError(message: string): string {
  const looksRaw =
    !message ||
    message.length > 260 ||
    /[<>]|soap|envelope|<\?xml|exception|stack\s?trace|https?:\/\/|\b[45]\d{2}\b/i.test(message);
  return looksRaw ? SAFE_QUOTE_FALLBACK : message;
}

/**
 * Closing line after a quote. Carries a light, HONEST nudge to decide: reserving secures
 * the shown price + the spot, and Localiza availability genuinely moves day to day (the same
 * reason the KB recommends booking ~7 days ahead). No fake scarcity, no countdowns.
 */
export function quoteClosingLine(): string {
  return "Reservar hoy te asegura este precio y el cupo —la disponibilidad cambia a diario. ¿Con cuál gama te gustaría seguir?";
}

/** Camioneta/SUV gamas (vs cars), told apart by the words Localiza puts in the descripción. */
function isCamioneta(descripcion: string): boolean {
  return /camioneta|suv|4\s?x\s?4|campero|todoterreno/i.test(descripcion);
}

/**
 * Social-proof + default recommendation under the quote: names the gama customers pick most
 * — the cheapest CAR (the económico), per the owner's real sales experience. This is true
 * social proof (never an invented percentage) AND a default that cuts the choice paralysis
 * of 5–10 gamas. Returns null when the table is empty. (Camioneta-seekers get the cheapest
 * camioneta steered in the conversational layer, not here.)
 */
/**
 * The recommended ("most-chosen") quote row: the ECONÓMICO car by category — in some cities a
 * sedán undercuts the económico, but customers still pick the económico most. Prefer the
 * "Económico"-labelled car (cheapest variant); fall back to the cheapest car; null when the
 * sede has no cars (only camionetas/SUVs). Also the default gama to commit when the customer
 * gives a buy signal without naming one.
 */
export function recommendedGama(
  table: QuoteTable,
  transmision?: string,
  tipoVehiculo?: string,
): QuoteTable["filas"][number] | null {
  // Respect the stated vehicle CLASS: a "camioneta/SUV/para 7" request must recommend a
  // camioneta, not the cheapest económico car (the vehicle-class half of gama_mismatch).
  const wantsCamioneta = tipoVehiculo === "camioneta";
  let pool = table.filas.filter((f) =>
    wantsCamioneta ? isCamioneta(f.descripcion) : !isCamioneta(f.descripcion),
  );
  if (!pool.length) return null;
  // Respect a stated transmission: NEVER default a customer who asked for "automático" into a
  // mechanical option (the gama_mismatch defect that booked the wrong product). If nothing
  // matches the stated class+transmission, return null so the caller ASKS instead of guessing.
  if (transmision === "automatico")
    pool = pool.filter((f) => /autom/i.test(f.descripcion));
  else if (transmision === "mecanico")
    pool = pool.filter((f) => /mec[aá]nic/i.test(f.descripcion));
  if (!pool.length) return null;
  const economicos = pool.filter((f) => /econ[oó]mico/i.test(f.descripcion));
  const finalPool = economicos.length ? economicos : pool;
  return finalPool.reduce((a, b) => (b.precioTotal < a.precioTotal ? b : a));
}

/**
 * Resolve a LABEL pick ("el más económico", "el intermedio", "el de la mitad") to a concrete
 * quoted row, deterministically — so the bot commits it instead of re-pasting the whole gama
 * list (the gama_not_committed that lost a ready buyer). Returns null when the message names no
 * such label. Económico respects the stated transmission/vehicle class.
 */
export function gamaByLabel(
  table: QuoteTable,
  message: string,
  transmision?: string,
  tipoVehiculo?: string,
): QuoteTable["filas"][number] | null {
  const m = message.toLowerCase();
  if (/m[aá]s econ[oó]mic|el econ[oó]mic|m[aá]s barat|el barat|la barat|lo m[aá]s barat/.test(m))
    return recommendedGama(table, transmision, tipoVehiculo);
  if (/intermedi|el de la mitad|el del medio|el de en medio|el mediano/.test(m)) {
    const autos = table.filas.filter((f) => !isCamioneta(f.descripcion));
    const rows = (autos.length ? autos : table.filas)
      .slice()
      .sort((a, b) => a.precioTotal - b.precioTotal);
    return rows.length ? rows[Math.floor((rows.length - 1) / 2)] : null;
  }
  return null;
}

export function gamaRecommendationLine(
  table: QuoteTable,
  transmision?: string,
  tipoVehiculo?: string,
): string | null {
  const top = recommendedGama(table, transmision, tipoVehiculo);
  return top
    ? `La que más eligen nuestros clientes es la **Gama ${top.categoria}** por su relación precio-valor.`
    : null;
}

/**
 * One-time notice when the customer asks for MORE THAN ONE vehicle. The chat books a
 * single vehicle per reservation across the whole stack (quote → Localiza → reserva),
 * so we surface the limit once and keep cotizando one; the rest is handed to an advisor.
 */
export function multiVehicleNoticeLine(): string {
  return (
    `Una nota: por este medio gestiono la reserva de **un vehículo** a la vez. ` +
    `Sigo cotizándote uno; si necesitas más de uno, dime y te comparto el contacto de un asesor para coordinar el resto.`
  );
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

/** Which customer datum is missing next, in order; null when all present. */
export type CustomerField = "fullname" | "document" | "email" | "phone";
export function nextCustomerField(c: ClienteSlots): CustomerField | null {
  if (!c.fullname) return "fullname";
  if (!c.identification_type || !c.identification) return "document";
  if (!c.email) return "email";
  if (!c.phone) return "phone";
  return null;
}

/**
 * The next customer datum to ask for, ESCALATING by `attempt` (1-based) so the same field
 * question is never repeated verbatim — the data-collection half of repeated_question_verbatim
 * (the bot re-firing "¿Tu nombre completo?" identically when the customer answered with a
 * question or unparsed data). attempt 1 = the warm funnel line; 2+ = rephrased with an example.
 * Light persuasion kept: low-friction framing, endowment, end-of-task momentum.
 */
export function nextCustomerQuestion(
  cliente: ClienteSlots,
  attempt = 1,
): string | null {
  const repeat = attempt >= 2;
  switch (nextCustomerField(cliente)) {
    case "fullname":
      return repeat
        ? "Solo me falta tu nombre completo (nombre y apellidos) para dejar la reserva 🙂"
        : "Perfecto, son solo unos datos rápidos y aseguramos tu reserva. ¿Tu nombre completo?";
    case "document":
      return repeat
        ? "¿Me confirmas tu documento? El tipo y el número, por ejemplo: CC 1018456722."
        : "¿Cuál es tu tipo y número de documento? (CC, CE o PA)";
    case "email":
      return repeat
        ? "¿A qué correo te mando la confirmación? (ej.: nombre@gmail.com)"
        : "¿A qué correo te envío la confirmación?";
    case "phone":
      return repeat
        ? "¿Cuál es tu número de celular para la reserva? (ej.: 3105567812)"
        : "¡Ya casi! Por último, ¿cuál es tu número de teléfono?";
    default:
      return null;
  }
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
/**
 * Safety net: if the gama about to be booked CONTRADICTS a preference the customer stated
 * (transmission or vehicle class), return an active warning so the wrong product isn't booked
 * silently — works no matter HOW the gama was resolved (deixis, default, model name), and stays
 * useful even after the Controller exists (defense in depth). null when there's no conflict.
 */
export function gamaConflictNote(
  row: QuoteTable["filas"][number],
  transmision?: string,
  tipoVehiculo?: string,
): string | null {
  const d = row.descripcion.toLowerCase();
  const isAuto = /autom/.test(d);
  const isMec = /mec[aá]nic/.test(d);
  if (transmision === "automatico" && isMec && !isAuto)
    return " ⚠️ Ojo: pediste automático y esta gama es mecánica; si prefieres una automática, dime y te la muestro.";
  if (transmision === "mecanico" && isAuto && !isMec)
    return " ⚠️ Ojo: pediste mecánico y esta gama es automática; si prefieres una mecánica, dime y te la muestro.";
  const cam = isCamioneta(row.descripcion);
  if (tipoVehiculo === "camioneta" && !cam)
    return " ⚠️ Ojo: pediste camioneta y esta gama es un auto; si quieres una camioneta, dime y te la muestro.";
  if (tipoVehiculo === "auto" && cam)
    return " ⚠️ Ojo: pediste un auto y esta gama es camioneta; si prefieres un auto, dime y te la muestro.";
  return null;
}

export function bookingSummaryBlock(state: ConversationState): string {
  const s = state.slots;
  const row =
    state.lastQuote && s.gama_elegida
      ? findGama(state.lastQuote, s.gama_elegida)
      : undefined;

  // `descripcion` already starts with "Gama X" — use it verbatim (no "Gama CX gama cx…").
  // "tu" frames it as already theirs (endowment effect) before they confirm.
  const gama = row ? `tu ${row.descripcion}` : "la gama elegida";
  const dias = row?.dias ?? state.lastQuote?.dias;
  const periodo = periodoCorto(s);

  const parts: string[] = [`Para cerrar, te confirmo: ${gama}`];
  if (s.ciudad) parts.push(`en ${capitalize(s.ciudad)}`);
  if (periodo) parts.push(periodo);
  if (dias) parts.push(`${dias} día${dias === 1 ? "" : "s"}`);

  let line = `${parts.join(", ")}.`;
  if (row) {
    // Per-day reframing (true math: total ÷ días) makes the all-in total feel smaller.
    const perDay =
      dias && dias > 0
        ? ` (≈$${COP.format(Math.round(row.precioTotal / dias))}/día, todo incluido)`
        : "";
    line += ` Total **$${COP.format(row.precioTotal)}**${perDay}.`;
    // Active mismatch alert — turns the passive gama echo into a real check before booking.
    const conflict = gamaConflictNote(row, s.transmision, s.tipo_vehiculo);
    if (conflict) line += conflict;
  }
  if (s.cliente.fullname) line += ` A nombre de ${s.cliente.fullname}.`;
  // Loss-aversion + present-bias close: confirming secures the price/spot, and nothing is
  // charged now (payment is at the sede). All TRUE — no upfront charge to reserve.
  line +=
    " Al confirmar aseguras este valor y el cupo; no se te cobra nada ahora —pagas en la sede al recoger. ¿Confirmo tu reserva?";
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

/**
 * Reply when an ALREADY-booked customer asks to change data or reports the email never
 * arrived. The chat CANNOT modify a confirmed reservation nor resend the email itself, so
 * it never promises to — it routes to a real advisor (the caller emits the WhatsApp button).
 */
export function postBookingChangeLine(): string {
  return (
    `Tu reserva ya quedó confirmada. Desde aquí no puedo cambiar los datos ni reenviarte el ` +
    `correo, pero un asesor sí puede ayudarte 👇 (revisa también spam/promociones).`
  );
}
