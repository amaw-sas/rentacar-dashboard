import { streamText, type UIMessageStreamWriter } from "ai";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { saveConversationState } from "@/lib/chat/persistence";
import { validateCustomerData } from "@/lib/chat/customer-validation";
import { executeBooking } from "@/lib/chat/booking-core";
import { extractSlots } from "./extract";
import {
  applyExtraction,
  type ConversationState,
  type Intent,
  type Phase,
} from "./slots";
import { findGama, getQuoteTable } from "./quote-service";
import { freeFormConfig } from "./prompts";
import {
  bookingConfirmedLine,
  bookingSummaryBlock,
  canQuote,
  gamaOptionsLine,
  greetingBlock,
  nextCustomerQuestion,
  nextQuoteQuestion,
  quoteClosingLine,
  quoteSignature,
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
  // generative text). Reused by every phase that needs to answer a side question.
  const freeForm = async () => {
    const cfg = await freeFormConfig(brand);
    const prompt = `Datos conocidos del cliente: ${JSON.stringify(
      state.slots,
    )}\nMensaje actual: "${userMessage}"`;
    const result = streamText({ ...cfg, prompt });
    writer.merge(result.toUIMessageStream());
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

  // 2. Greeting — code, once.
  if (!state.flags.greeted) {
    writeText(greetingBlock(brand, now));
    state = { ...state, flags: { ...state.flags, greeted: true } };
  }

  const { ciudad, fecha_recogida, fecha_devolucion } = state.slots;
  const wantsQuote =
    intent === "saludo" ||
    intent === "cotizar" ||
    intent === "elige_gama" ||
    canQuote(state.slots);
  const sig = quoteSignature(state.slots);
  const quoteIsStale =
    !state.flags.quote_shown || state.flags.last_quote_signature !== sig;
  const hasQuote = Boolean(state.lastQuote && state.flags.quote_shown);

  if (
    wantsQuote &&
    ciudad &&
    fecha_recogida &&
    fecha_devolucion &&
    quoteIsStale
  ) {
    // First quote → requisitos once, then the table (both code-emitted). A re-quote
    // (changed ciudad/fechas/sede) resets the booking phase back to `quoted`.
    if (!state.flags.requisitos_shown) {
      writeText(requisitosBlock());
      state = { ...state, flags: { ...state.flags, requisitos_shown: true } };
    }
    const qr = await getQuoteTable({
      ciudad,
      fecha_recogida,
      fecha_devolucion,
      hora_recogida: state.slots.hora_recogida,
      hora_devolucion: state.slots.hora_devolucion,
      sede: state.slots.sede,
    });
    if (qr.ok) {
      writer.write({ type: "data-quoteTable", data: quoteTableData(qr.table) });
      writeText(quoteClosingLine());
      state = {
        ...state,
        phase: "quoted",
        lastQuote: qr.table,
        flags: {
          ...state.flags,
          quote_shown: true,
          last_quote_signature: sig,
          // A fresh quote invalidates any prior summary.
          summary_shown: false,
        },
      };
    } else {
      writeText(qr.message);
    }
  } else if (hasQuote) {
    // BOOKING PHASE MACHINE (Etapa 3): a quote exists and we're not re-quoting.
    state = await advanceBooking({
      writer,
      writeText,
      freeForm,
      state,
      intent,
      userMessage,
      brand,
      conversationId,
      ipHash,
    });
  } else if (wantsQuote && !canQuote(state.slots)) {
    // Funnel: ask the next missing slot deterministically (no LLM).
    const q = nextQuoteQuestion(state.slots);
    if (q) writeText(q);
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

interface BookingStepInput {
  writer: UIMessageStreamWriter;
  writeText: (text: string) => void;
  freeForm: () => Promise<void>;
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
  const { writeText, freeForm, intent, userMessage } = input;
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
        // Gama picked → move to collecting customer data and ask the first gap.
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
      // Off-funnel question while still choosing → answer, then nudge the choice.
      await freeForm();
      writeText(gamaOptionsLine(lastQuote));
      return { ...state, phase: "choosing_gama" };
    }

    case "collecting_customer": {
      if (OFF_FUNNEL.has(intent)) {
        // Side question mid-collection → answer, then re-ask the current gap.
        await freeForm();
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
      if (OFF_FUNNEL.has(intent)) await freeForm();
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
      await freeForm();
      return state;
    }

    default:
      // greeting/collecting/fallback shouldn't reach here once a quote exists.
      await freeForm();
      return state;
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
