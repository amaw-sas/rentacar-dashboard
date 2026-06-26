import { streamText, type UIMessageStreamWriter } from "ai";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { saveConversationState } from "@/lib/chat/persistence";
import { validateCustomerData } from "@/lib/chat/customer-validation";
import { executeBooking } from "@/lib/chat/booking-core";
import { buildOnDemandLinks } from "@/lib/chat/reserva-link";
import { getLocationDirectory } from "@/lib/api/location-directory";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import { extractSlots } from "./extract";
import {
  applyExtraction,
  type ConversationState,
  type Intent,
  type Phase,
} from "./slots";
import { findGama, getQuoteTable, type QuoteRow } from "./quote-service";
import { getGamaCards } from "./gama-cards";
import { freeFormConfig } from "./prompts";
import {
  bookingConfirmedLine,
  bookingSummaryBlock,
  canQuote,
  gamaNudgeLine,
  gamaOptionsLine,
  gamaRecommendationLine,
  greetingBlock,
  horaExtraLine,
  multiVehicleNoticeLine,
  nextCustomerQuestion,
  nextQuoteSlot,
  postBookingChangeLine,
  quoteSlotQuestion,
  quoteClosingLine,
  quoteCoreSignature,
  quoteSignature,
  quotesPriceEqual,
  quoteTableData,
  requisitosBlock,
} from "./blocks";

/**
 * Hybrid orchestrator turn (Rediseño híbrido · Etapas 2–3).
 *
 * Code owns the funnel AND the close. The FIXED blocks (greeting, requisitos, quote
 * table, customer questions, booking summary, confirmation) are emitted by code,
 * guarded by flags/phase — so the model can never re-greet, re-paste them, or
 * double-book. The LLM is used in two narrow roles only: slot extraction (one read)
 * and a short free-form reply for off-funnel messages. Once a quote exists, the turn
 * runs a deterministic phase machine (choosing_gama → collecting_customer →
 * confirming → booked) that calls the shared `executeBooking` to create the REAL
 * reservation. Gated behind CHAT_ORCHESTRATOR=on; the legacy all-LLM path stays as
 * instant rollback.
 */

export interface RunTurnInput {
  brand: string;
  conversationId: string | null;
  state: ConversationState;
  userMessage: string;
  /** Older→newer plain-text context lines for the extractor. */
  recentContext: string[];
  now: Date;
  /** Salted client-IP hash for the booking rate cap (threaded by the route). */
  ipHash?: string;
}

/** Off-funnel intents: questions/objections that the free-form LLM answers. */
const OFF_FUNNEL: ReadonlySet<Intent> = new Set<Intent>([
  "pregunta_sede",
  "pregunta_gama",
  "pregunta_mensual",
  "pregunta_horas_extra",
  "objecion",
  "pedir_enlace",
  "hablar_asesor",
  "tangencial",
  "fuera_de_tema",
]);

/**
 * Guidance appended to the free-form prompt once the reservation is `booked`. Without
 * it, the tool-enabled free-form (which still has the quote tools) re-cotizes and offers
 * to "apartar" again when a booked customer sends, say, a new email — the post-confirmation
 * re-quote bug. The reservation is terminal; the model must only answer, never re-open it.
 */
const BOOKED_DONE_GUIDANCE =
  "IMPORTANTE: la reserva del cliente YA está confirmada y enviada a su correo/WhatsApp. " +
  "NO vuelvas a cotizar, NO ofrezcas 'apartar' ni reservar de nuevo. NO prometas reenviar tú " +
  "el correo ni modificar la reserva (no puedes hacerlo desde el chat); si lo pide, ofrécele " +
  "pasarlo con un asesor. Solo responde su consulta.";

/** A clear affirmative that authorizes the booking ("sí", "confirmo", "dale", ...). */
function isAffirmative(message: string): boolean {
  const m = message
    .trim()
    .toLowerCase()
    .replace(/[¡!.,…]/g, "");
  if (m === "si" || m === "sí" || m === "ok" || m === "dale") return true;
  return /\b(s[ií]|claro|confirmo|conf[ií]rmala|confirmala|h[aá]zlo|hazlo|ap[aá]rtalo|apartalo|okay|listo|de una|perfecto)\b/.test(
    m,
  );
}

export async function runTurn(
  writer: UIMessageStreamWriter,
  input: RunTurnInput,
): Promise<void> {
  const { brand, conversationId, userMessage, recentContext, now, ipHash } =
    input;
  let state = input.state;

  let blockId = 0;
  const writeText = (text: string) => {
    const id = `blk-${blockId++}`;
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: text });
    writer.write({ type: "text-end", id });
  };

  // A short, tool-enabled free-form reply for off-funnel messages (the only
  // generative text). Two flavors share one config:
  //  - freeForm(): streams straight to the writer. Use STANDALONE (no code line after).
  //  - freeFormText(): awaits the full text so the caller can writeText() it BEFORE a
  //    deterministic follow-up (nudge / next question), keeping the bubble order
  //    "answer → follow-up". Streaming + a synchronous follow-up race the wrong way
  //    (the follow-up lands first), which is the out-of-order nudge bug.
  const freeFormResult = async (guidance?: string) => {
    const cfg = await freeFormConfig(brand);
    const prompt = `Datos conocidos del cliente: ${JSON.stringify(
      state.slots,
    )}\nMensaje actual: "${userMessage}"${guidance ? `\n\n${guidance}` : ""}`;
    return streamText({ ...cfg, prompt });
  };
  const freeForm = async (guidance?: string) => {
    writer.merge((await freeFormResult(guidance)).toUIMessageStream());
  };
  const freeFormText = async (guidance?: string): Promise<string> => {
    try {
      return await (await freeFormResult(guidance)).text;
    } catch (e) {
      console.error("[orchestrator] freeFormText failed", e);
      return "";
    }
  };

  // 1. The one narrow LLM read: extract intent + slot updates. Degrade to a
  // free-form reply if it fails (never block the turn).
  let intent: Intent = "tangencial";
  try {
    const ext = await extractSlots({
      todayYMD: bogotaTodayYMD(now),
      state,
      recentContext,
      userMessage,
    });
    state = applyExtraction(state, ext);
    intent = ext.intent;
  } catch (e) {
    console.error("[orchestrator] extract failed", e);
  }

  // Guard the gama choice: the extractor sometimes reads a "choice" from a preference
  // in the initial REQUEST ("quiero un económico") before any quote exists, or
  // hallucinates an invalid code (e.g. "E" from "económico"). A real choice needs a
  // shown quote AND must resolve to a quoted gama — otherwise drop it so the funnel
  // never skips to data collection on a phantom pick.
  if (
    state.slots.gama_elegida &&
    !(state.lastQuote && findGama(state.lastQuote, state.slots.gama_elegida))
  ) {
    state = { ...state, slots: { ...state.slots, gama_elegida: undefined } };
  }

  // 2. Greeting — code, once.
  if (!state.flags.greeted) {
    writeText(greetingBlock(brand, now));
    state = { ...state, flags: { ...state.flags, greeted: true } };
  }

  // Multi-vehicle: the chat books ONE vehicle per reservation across the whole stack.
  // Surface the limit ONCE when the customer asks for more than one, then keep cotizando
  // a single vehicle (the quote/booking that follow are unaffected).
  if ((state.slots.cantidad ?? 0) >= 2 && !state.flags.multi_vehicle_notice_shown) {
    writeText(multiVehicleNoticeLine());
    state = {
      ...state,
      flags: { ...state.flags, multi_vehicle_notice_shown: true },
    };
  }

  const { ciudad, fecha_recogida, fecha_devolucion } = state.slots;
  const wantsQuote =
    intent === "saludo" ||
    intent === "cotizar" ||
    intent === "elige_gama" ||
    canQuote(state.slots);
  const sig = quoteSignature(state.slots);
  const coreSig = quoteCoreSignature(state.slots);
  // "Stale" = we have NOT yet tried this exact quote signature. Counts a prior failed
  // attempt (last_attempt_signature) so we never re-fire the same failing quote turn after
  // turn (the stuck-error loop); the success path (quote_shown + matching last_quote_signature)
  // also counts, for backward-compatible state that predates last_attempt_signature.
  const quoteIsStale = !(
    state.flags.last_attempt_signature === sig ||
    (state.flags.quote_shown && state.flags.last_quote_signature === sig)
  );
  const hasQuote = Boolean(state.lastQuote && state.flags.quote_shown);
  // A booked reservation is TERMINAL: never re-quote/re-open it. A booked customer who
  // mentions a new date/sede ("¿y si la devuelvo el 5?") must reach advanceBooking's
  // booked case, not a re-quote that resets phase to `quoted`.
  const freshQuotePending = Boolean(
    state.phase !== "booked" &&
      wantsQuote &&
      ciudad &&
      fecha_recogida &&
      fecha_devolucion &&
      quoteIsStale,
  );
  // A sede-only change (ciudad/fechas/horas unchanged) since the last quote. The price
  // CAN vary per sede, so we still refresh — but silently: re-pasting the whole table and
  // resetting the funnel on every sede pick is the repetition the user reported.
  const sedeOnlyChange =
    freshQuotePending &&
    hasQuote &&
    state.flags.last_quote_core_signature === coreSig;

  // freshQuotePending guarantees ciudad + both dates are present.
  const quoteArgs = () => ({
    ciudad: ciudad!,
    fecha_recogida: fecha_recogida!,
    fecha_devolucion: fecha_devolucion!,
    hora_recogida: state.slots.hora_recogida,
    hora_devolucion: state.slots.hora_devolucion,
    sede: state.slots.sede,
  });
  const continueBooking = () =>
    advanceBooking({
      writer,
      writeText,
      freeFormText,
      state,
      intent,
      userMessage,
      brand,
      conversationId,
      ipHash,
    });
  const emitQuoteTable = (table: NonNullable<ConversationState["lastQuote"]>) => {
    writer.write({ type: "data-quoteTable", data: quoteTableData(table) });
    // Social-proof + default recommendation (the most-chosen gama), then the decision CTA.
    const rec = gamaRecommendationLine(table);
    if (rec) writeText(rec);
    writeText(quoteClosingLine());
  };

  // On-demand intercept (Etapa 4): vehicle cards, the self-serve reservation link, or the
  // advisor WhatsApp. Runs unless a REAL fresh quote is pending — but a sede-only change is
  // not a real re-quote, so an explicit on-demand request that also names a sede ("el enlace
  // en el aeropuerto") is still honored instead of being swallowed by the silent refresh.
  let onDemandHandled = false;
  if (!freshQuotePending || sedeOnlyChange) {
    onDemandHandled = await handleOnDemand({
      writer,
      writeText,
      state,
      intent,
      userMessage,
      brand,
    });
    if (onDemandHandled) {
      const rp = phaseReprompt(state);
      if (rp) writeText(rp);
    }
  }

  if (onDemandHandled) {
    // On-demand already emitted its part(s) + any phase re-prompt; nothing else.
  } else if (sedeOnlyChange) {
    const prevQuote = state.lastQuote;
    const qr = await getQuoteTable(quoteArgs());
    if (qr.ok && prevQuote && quotesPriceEqual(prevQuote, qr.table)) {
      // Same prices for this sede → DON'T re-paste the table; refresh the blobs and keep
      // the booking funnel moving (advanceBooking re-asks the current phase's question).
      state = {
        ...state,
        lastQuote: qr.table,
        flags: {
          ...state.flags,
          last_quote_signature: sig,
          last_quote_core_signature: coreSig,
          last_attempt_signature: sig,
        },
      };
      state = await continueBooking();
    } else if (qr.ok) {
      // Prices genuinely differ by sede → show the updated table (it's new info), reset to
      // `quoted`, and CLEAR the prior gama pick so the customer re-confirms against the new
      // prices instead of being silently locked into the old one at a new total.
      emitQuoteTable(qr.table);
      state = {
        ...state,
        phase: "quoted",
        slots: { ...state.slots, gama_elegida: undefined },
        lastQuote: qr.table,
        flags: {
          ...state.flags,
          quote_shown: true,
          last_quote_signature: sig,
          last_quote_core_signature: coreSig,
          last_attempt_signature: sig,
          summary_shown: false,
        },
      };
    } else {
      // Re-quote for the new sede FAILED. Surface the error once and record the attempt so
      // we don't repeat it every turn; don't advance on a stale, old-sede quote.
      writeText(qr.message);
      state = {
        ...state,
        flags: { ...state.flags, last_attempt_signature: sig },
      };
    }
  } else if (freshQuotePending) {
    // First quote OR a real price-driver change (ciudad/fechas/horas). Emit requisitos +
    // table (both code-owned), resetting the booking phase to `quoted`. Requisitos only when
    // the quote SUCCEEDS — showing them right before a "no disponible" message reads wrong.
    const qr = await getQuoteTable(quoteArgs());
    if (qr.ok) {
      if (!state.flags.requisitos_shown) {
        writeText(requisitosBlock());
        state = { ...state, flags: { ...state.flags, requisitos_shown: true } };
      }
      emitQuoteTable(qr.table);
      state = {
        ...state,
        phase: "quoted",
        lastQuote: qr.table,
        flags: {
          ...state.flags,
          quote_shown: true,
          last_quote_signature: sig,
          last_quote_core_signature: coreSig,
          last_attempt_signature: sig,
          // A fresh quote invalidates any prior summary.
          summary_shown: false,
        },
      };
    } else {
      // Quote FAILED (no availability / out of hours / past date / city not found). Surface
      // the error ONCE and record the attempt, so the next turn isn't another identical retry
      // — the free-form then answers the customer instead of repeating the error forever.
      writeText(qr.message);
      state = {
        ...state,
        flags: { ...state.flags, last_attempt_signature: sig },
      };
    }
  } else if (hasQuote) {
    // BOOKING PHASE MACHINE (Etapa 3): a quote exists and we're not re-quoting.
    state = await continueBooking();
  } else if (wantsQuote && !canQuote(state.slots)) {
    // Funnel: ask the next missing slot deterministically. If the customer also asked a
    // question before giving the slot (e.g. "¿cuánto con IVA?" — the extractor often tags
    // these as `cotizar`), answer it FIRST so we don't steamroll it with "¿qué fecha?".
    if (userMessage.includes("?")) {
      const ans = await freeFormText();
      if (ans) writeText(ans);
    }
    const slot = nextQuoteSlot(state.slots);
    if (slot) {
      // If we asked for this same slot last turn and still don't have it (the customer sent
      // a greeting / name / off-topic line), VARY the phrasing instead of repeating it.
      const repeated = state.flags.last_slot_asked === slot;
      writeText(quoteSlotQuestion(slot, repeated));
      state = { ...state, flags: { ...state.flags, last_slot_asked: slot } };
    }
  } else {
    // Off-funnel before any quote: short free-form reply.
    await freeForm();
  }

  // 3. Persist state (best-effort; the message itself is persisted by the route's onFinish).
  if (conversationId) {
    try {
      await saveConversationState(conversationId, state);
    } catch (e) {
      console.error("[orchestrator] saveConversationState failed", e);
    }
  }
}

// ---------------------------------------------------------------------------
// On-demand handling (Etapa 4): vehicle cards, reservation link, advisor WhatsApp.
// All code-owned; the LLM is never asked to format these. Each helper emits its
// data part(s) + ONE short code line and returns whether it handled the message.
// ---------------------------------------------------------------------------

/** Customer asks to see the vehicles/photos/models of a gama. */
const VEHICLE_RE =
  /foto|imagen|im[aá]gen|modelos?|qu[eé]\s+(carros|veh[ií]culos|autos)|cu[aá]les?\s+(carros|veh[ií]culos)|ver\s+(los\s+)?(carros|veh[ií]culos|modelos)/i;

interface OnDemandInput {
  writer: UIMessageStreamWriter;
  writeText: (text: string) => void;
  state: ConversationState;
  intent: Intent;
  userMessage: string;
  brand: string;
}

/** Customer slots → the booking customer shape (empty strings for unknown fields). */
function customerFromSlots(state: ConversationState) {
  const c = state.slots.cliente;
  return {
    fullname: c.fullname ?? "",
    identification_type: c.identification_type ?? "",
    identification: c.identification ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
  };
}

/**
 * Resolve which quoted gama the customer means: the chosen slot first, else a gama
 * code named in the message that exists in the last quote. Single-letter codes only
 * match when prefixed by "gama" (so "favor" never resolves to gama F).
 */
function resolveOnDemandGama(
  state: ConversationState,
  userMessage: string,
): QuoteRow | undefined {
  const lastQuote = state.lastQuote;
  if (!lastQuote) return undefined;
  if (state.slots.gama_elegida) {
    const r = findGama(lastQuote, state.slots.gama_elegida);
    if (r) return r;
  }
  const msg = userMessage.toLowerCase();
  for (const f of lastQuote.filas) {
    const code = f.categoria.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!code) continue;
    const re =
      code.length === 1
        ? new RegExp(`\\bgama\\s+${code}\\b`, "i")
        : new RegExp(`\\b(?:gama\\s+)?${code}\\b`, "i");
    if (re.test(msg)) return f;
  }
  return undefined;
}

/**
 * Emit the on-demand response for the message, or return false when it's not an
 * on-demand request the code can satisfy (caller falls back to the normal flow /
 * free-form reply). Never mutates phase/flags and never re-quotes/re-books.
 */
async function handleOnDemand(input: OnDemandInput): Promise<boolean> {
  const { writer, writeText, state, intent, userMessage, brand } = input;
  const lastQuote = state.lastQuote;

  // 0. Extra-hour price: Localiza only returns the charge when the quote spans extra
  // hours, so we re-quote with a one-hour-later return and read precio_hora_extra for
  // the relevant gama. On any failure, fall through to free-form (it gives the policy).
  if (intent === "pregunta_horas_extra" && lastQuote) {
    if (await answerHoraExtra(input)) return true;
  }

  // 1. Show vehicle cards (photos/models) for a gama.
  const wantsVehicles =
    intent === "pregunta_gama" || VEHICLE_RE.test(userMessage);
  if (wantsVehicles) {
    const row = resolveOnDemandGama(state, userMessage);
    if (row) {
      const part = await getGamaCards(row.categoria, row.descripcion);
      if (!part) return false; // no real cards → don't promise photos; free-form.
      writer.write({ type: "data-gamaCards", data: part });
      writeText(
        `Estos son los modelos que suelen venir en la Gama ${row.categoria}; el modelo exacto se asigna en sede.`,
      );
      return true;
    }
    // Couldn't pin a gama (no gama named, or the extractor labeled an unrelated
    // question like "¿gasolina o diésel?" as pregunta_gama). Do NOT re-paste the whole
    // gama list — let free-form answer the real question; the off-funnel branch then
    // adds a short nudge. The quote table already lists the gamas.
    return false;
  }

  // 2. Self-serve reservation link.
  if (intent === "pedir_enlace") {
    const row = resolveOnDemandGama(state, userMessage);
    if (row) {
      const links = await onDemandLinksFor(row, state, brand);
      if (links) {
        writer.write({ type: "data-buttons", data: { web: links.webUrl } });
        writeText("Te dejo el enlace para reservar tú mismo abajo.");
        return true;
      }
    }
    return false; // no gama/quote (or link build failed) → free-form.
  }

  // 3. Advisor WhatsApp.
  if (intent === "hablar_asesor") {
    const row = resolveOnDemandGama(state, userMessage);
    if (row) {
      const links = await onDemandLinksFor(row, state, brand);
      if (links) {
        writer.write({ type: "data-buttons", data: { whatsapp: links.whatsappUrl } });
        writeText("Te dejo el contacto de un asesor abajo.");
        return true;
      }
    }
    // No quote (or build failed): a neutral advisor wa.me for the brand.
    const number = getFranchiseBranding(brand).whatsapp;
    const whatsapp = `https://wa.me/${number}?text=${encodeURIComponent(
      "Hola, quiero información sobre alquiler de carros.",
    )}`;
    writer.write({ type: "data-buttons", data: { whatsapp } });
    writeText("Te dejo el contacto de un asesor abajo.");
    return true;
  }

  return false;
}

/** Build the on-demand links for a chosen gama row; null on any failure. */
async function onDemandLinksFor(
  row: QuoteRow,
  state: ConversationState,
  brand: string,
) {
  try {
    const directory = await getLocationDirectory();
    return buildOnDemandLinks(
      {
        brand,
        quote: row.quote,
        gamaDescripcion: row.descripcion,
        customer: customerFromSlots(state),
      },
      directory,
    );
  } catch (e) {
    console.error("[orchestrator] onDemandLinksFor failed", e);
    return null;
  }
}

/**
 * Probe offset for the extra-hour re-quote. Localiza bills extra hours only in a narrow
 * band: a ~1h grace returns 0, hours 2–4 are billed proportionally (linear per-hour
 * rate), and >4 flips to a full extra day (0 extra hours again). So we re-quote at
 * pickup + 3h — squarely in the billable band — and divide to get the per-hour rate.
 */
const EXTRA_HOUR_PROBE_OFFSET = 3;

/** "10:00" → "13:00" (pickup + EXTRA_HOUR_PROBE_OFFSET). null when it would cross midnight. */
function extraHourDropoff(hhmm: string): string | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isInteger(h) || h < 0 || h + EXTRA_HOUR_PROBE_OFFSET > 23) return null;
  const mm = Number.isInteger(m) ? m : 0;
  return `${String(h + EXTRA_HOUR_PROBE_OFFSET).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Answer "¿cuánto vale la hora extra?" with a REAL figure. The quoted total bakes extra
 * hours in (0 when return ≤ pickup), so a plain quote can't price one hour. We re-quote
 * the same city/dates/sede with the return bumped into Localiza's billable band (pickup +
 * EXTRA_HOUR_PROBE_OFFSET), read precio_hora_extra for the resolved gama, and divide by
 * horasExtra to get the per-hour rate. Returns false when it can't price it (incomplete
 * slots, re-quote failed, or 0) so the caller falls back to the free-form policy answer.
 * Read-only: never touches phase/flags, never books.
 */
async function answerHoraExtra(input: OnDemandInput): Promise<boolean> {
  const { writeText, state, userMessage } = input;
  const s = state.slots;
  if (!s.ciudad || !s.fecha_recogida || !s.fecha_devolucion) return false;
  const pickup = s.hora_recogida ?? "10:00";
  const dropoff = extraHourDropoff(pickup);
  if (!dropoff) return false;

  const qr = await getQuoteTable({
    ciudad: s.ciudad,
    fecha_recogida: s.fecha_recogida,
    fecha_devolucion: s.fecha_devolucion,
    hora_recogida: pickup,
    hora_devolucion: dropoff,
    sede: s.sede,
  });
  if (!qr.ok) return false;

  // The gama the client means: chosen slot, or one named in the message, else the first
  // (cheapest) row as a representative. Resolve against the re-quote's rows.
  const row =
    resolveOnDemandGama({ ...state, lastQuote: qr.table }, userMessage) ??
    qr.table.filas[0];
  if (!row || row.precioHoraExtra <= 0) return false;

  const unit =
    row.horasExtra > 0
      ? Math.round(row.precioHoraExtra / row.horasExtra)
      : row.precioHoraExtra;
  writeText(horaExtraLine(row.categoria, s.ciudad, unit));
  return true;
}

/**
 * After handling an on-demand request mid-funnel, re-emit the current phase's
 * question so the customer knows what we still need. null for phases with no pending
 * question (greeting/quoted/booked/...).
 */
function phaseReprompt(state: ConversationState): string | null {
  switch (state.phase) {
    case "choosing_gama":
      // Short nudge, not the full gama list (the table already shows it).
      return state.lastQuote ? gamaNudgeLine() : null;
    case "collecting_customer":
      return nextCustomerQuestion(state.slots.cliente);
    case "confirming":
      return "Cuando quieras te confirmo la reserva, ¿la confirmo?";
    default:
      return null;
  }
}

interface BookingStepInput {
  writer: UIMessageStreamWriter;
  writeText: (text: string) => void;
  /** Awaited free-form text so side answers land BEFORE the deterministic follow-up.
   * `guidance` appends a per-call instruction (e.g. the booked-done note). */
  freeFormText: (guidance?: string) => Promise<string>;
  state: ConversationState;
  intent: Intent;
  userMessage: string;
  brand: string;
  conversationId: string | null;
  ipHash?: string;
}

/**
 * Advance the deterministic booking machine for a turn where a quote already
 * exists. Returns the next state; emits the phase's fixed block(s) and, on
 * confirmation, calls `executeBooking` for the REAL reservation. Once `booked`, it
 * never books again — the "second sí" is structurally impossible.
 */
async function advanceBooking(
  input: BookingStepInput,
): Promise<ConversationState> {
  const { writeText, freeFormText, intent, userMessage } = input;
  const state = input.state;
  const lastQuote = state.lastQuote;
  if (!lastQuote) return state; // unreachable (guarded by hasQuote)

  switch (state.phase) {
    case "quoted":
    case "choosing_gama": {
      const chosen = state.slots.gama_elegida
        ? findGama(lastQuote, state.slots.gama_elegida)
        : undefined;
      if (chosen) {
        // Gama picked → move to collecting customer data. If the SAME message also
        // carried a question ("la C, ¿hay sede cerca?"), answer it first so we don't
        // tunnel straight to "¿tu nombre?" and drop what they asked.
        if (userMessage.includes("?")) {
          const ans = await freeFormText();
          if (ans) writeText(ans);
        }
        return progressCustomer(
          { ...state, phase: "collecting_customer" },
          writeText,
        );
      }
      if (intent === "elige_gama") {
        // Named a gama that isn't in the table → ask for a valid one.
        writeText(gamaOptionsLine(lastQuote));
        return { ...state, phase: "choosing_gama" };
      }
      // Off-funnel question while still choosing → answer, then a SHORT nudge. We must
      // NOT re-paste the whole gama list every turn (the repetition the user reported);
      // the quote table already shows them.
      const ans = await freeFormText();
      if (ans) writeText(ans);
      writeText(gamaNudgeLine());
      return { ...state, phase: "choosing_gama" };
    }

    case "collecting_customer": {
      if (OFF_FUNNEL.has(intent)) {
        // Side question mid-collection → answer, then re-ask the current gap.
        const ans = await freeFormText();
        if (ans) writeText(ans);
        const q = nextCustomerQuestion(state.slots.cliente);
        if (q) writeText(q);
        return state;
      }
      return progressCustomer(state, writeText);
    }

    case "confirming": {
      // Gama swapped mid-confirm → re-summarize with the new gama.
      if (intent === "elige_gama" && state.slots.gama_elegida) {
        const row = findGama(lastQuote, state.slots.gama_elegida);
        if (row) {
          return progressCustomer(
            {
              ...state,
              phase: "collecting_customer",
              flags: { ...state.flags, summary_shown: false },
            },
            writeText,
          );
        }
      }

      const affirm =
        intent === "confirma_reserva" || isAffirmative(userMessage);
      if (affirm) {
        return bookNow(input, lastQuote);
      }

      // Not a confirmation. Answer any side question, then re-prompt (NOT the full
      // summary again — it was already shown when we entered `confirming`).
      if (OFF_FUNNEL.has(intent)) {
        const ans = await freeFormText();
        if (ans) writeText(ans);
      }
      if (!state.flags.summary_shown) {
        const next: ConversationState = {
          ...state,
          flags: { ...state.flags, summary_shown: true },
        };
        writeText(bookingSummaryBlock(next));
        return next;
      }
      writeText("Cuando quieras te confirmo la reserva, ¿la confirmo?");
      return state;
    }

    case "booked": {
      // Already booked — NEVER book again. A repeated "sí"/confirm must NOT re-open
      // the funnel (the free-form LLM, blind to the booking, would ask for a sede "to
      // emit it" and contradict the confirmation). Acknowledge deterministically; only
      // hand a genuine new question to the free-form reply.
      if (intent === "confirma_reserva" || isAffirmative(userMessage)) {
        writeText(
          "Tu reserva ya quedó confirmada; te llegaron los detalles al correo y WhatsApp. ¿Te ayudo con algo más?",
        );
        return state;
      }
      // Post-booking data/correction ("no me llegó, mándalo a otro correo" / "mi cédula está
      // mal"). The chat CANNOT modify a confirmed reservation nor resend the email itself —
      // so route to a real advisor honestly instead of promising a reenvío no code performs.
      if (intent === "da_datos") {
        writeText(postBookingChangeLine());
        const number = getFranchiseBranding(input.brand).whatsapp;
        const whatsapp = `https://wa.me/${number}?text=${encodeURIComponent(
          "Hola, ya tengo una reserva confirmada y necesito ayuda con mis datos/confirmación.",
        )}`;
        input.writer.write({ type: "data-buttons", data: { whatsapp } });
        return state;
      }
      // Genuine new question → free-form, but TELL it the booking is done so it can't
      // re-quote, offer to apartar, or promise a reenvío.
      const ans = await freeFormText(BOOKED_DONE_GUIDANCE);
      if (ans) writeText(ans);
      return state;
    }

    default: {
      // greeting/collecting/fallback shouldn't reach here once a quote exists.
      const ans = await freeFormText();
      if (ans) writeText(ans);
      return state;
    }
  }
}

/**
 * Customer-data step (pure-ish; writes blocks): ask the next missing field, OR
 * (when all present) validate and either relay the validation error or transition
 * to `confirming` emitting the booking summary ONCE (guarded by summary_shown).
 */
function progressCustomer(
  state: ConversationState,
  writeText: (text: string) => void,
): ConversationState {
  const q = nextCustomerQuestion(state.slots.cliente);
  if (q) {
    writeText(q);
    return { ...state, phase: "collecting_customer" };
  }

  const c = state.slots.cliente;
  const valid = validateCustomerData({
    fullname: c.fullname ?? "",
    identification_type: c.identification_type ?? "",
    identification: c.identification ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
  });
  if (!valid.ok) {
    writeText(valid.error);
    return { ...state, phase: "collecting_customer" };
  }

  let next: ConversationState = { ...state, phase: "confirming" as Phase };
  if (!next.flags.summary_shown) {
    writeText(bookingSummaryBlock(next));
    next = { ...next, flags: { ...next.flags, summary_shown: true } };
  }
  return next;
}

/**
 * Create the real reservation from `confirming` and map the outcome. The fallback
 * links (cap hit / provider failure) are emitted as a `data-buttons` part — the
 * text NEVER carries a URL. After a successful booking we move to `booked` so a
 * repeated "sí" can never book twice.
 */
async function bookNow(
  input: BookingStepInput,
  lastQuote: NonNullable<ConversationState["lastQuote"]>,
): Promise<ConversationState> {
  const { writer, writeText, state, brand, conversationId, ipHash } = input;

  const chosen = state.slots.gama_elegida
    ? findGama(lastQuote, state.slots.gama_elegida)
    : undefined;
  if (!chosen) {
    // Lost the gama somehow → back to choosing.
    writeText(gamaOptionsLine(lastQuote));
    return { ...state, phase: "choosing_gama" };
  }

  const c = state.slots.cliente;
  const outcome = await executeBooking({
    brand,
    quote: chosen.quote,
    customer: {
      fullname: c.fullname ?? "",
      identification_type: c.identification_type ?? "",
      identification: c.identification ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
    },
    gamaDescripcion: chosen.descripcion,
    ctx: { conversationId, ipHash },
  });

  switch (outcome.kind) {
    case "ok":
      writeText(bookingConfirmedLine(outcome.data));
      return { ...state, phase: "booked" };

    case "disabled":
      writeText(
        "Por ahora la reserva se termina en el sitio; abajo te dejo el enlace.",
      );
      writer.write({ type: "data-buttons", data: { web: outcome.website } });
      return { ...state, phase: "booked" };

    case "blocked":
    case "failed":
      writeText(outcome.message);
      if (outcome.links) {
        writer.write({
          type: "data-buttons",
          data: { web: outcome.links.webUrl, whatsapp: outcome.links.whatsappUrl },
        });
      }
      // Lead handed off — don't loop back into a re-book.
      return { ...state, phase: "booked" };

    case "invalid":
      // Defensive (we validated before confirming): re-collect with a fresh summary.
      writeText(outcome.message);
      return {
        ...state,
        phase: "collecting_customer",
        flags: { ...state.flags, summary_shown: false },
      };
  }
}
