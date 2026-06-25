import { streamText, type UIMessageStreamWriter } from "ai";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { saveConversationState } from "@/lib/chat/persistence";
import { extractSlots } from "./extract";
import { applyExtraction, type ConversationState, type Intent } from "./slots";
import { getQuoteTable } from "./quote-service";
import { freeFormConfig } from "./prompts";
import {
  canQuote,
  greetingBlock,
  nextQuoteQuestion,
  quoteClosingLine,
  quoteSignature,
  quoteTableData,
  requisitosBlock,
} from "./blocks";

/**
 * Hybrid orchestrator turn (Rediseño híbrido · Etapa 2).
 *
 * Code owns the funnel and emits the FIXED blocks (greeting, requisitos, quote
 * table) exactly once, guarded by flags — so the model can never re-greet or
 * re-paste them. The LLM is used in two narrow roles only: slot extraction (one
 * read) and a short free-form reply for off-funnel messages. This is the structural
 * fix for the repetition class. Gated behind CHAT_ORCHESTRATOR=on; the legacy
 * all-LLM path stays as instant rollback.
 */

export interface RunTurnInput {
  brand: string;
  conversationId: string | null;
  state: ConversationState;
  userMessage: string;
  /** Older→newer plain-text context lines for the extractor. */
  recentContext: string[];
  now: Date;
}

export async function runTurn(
  writer: UIMessageStreamWriter,
  input: RunTurnInput,
): Promise<void> {
  const { brand, conversationId, userMessage, recentContext, now } = input;
  let state = input.state;

  let blockId = 0;
  const writeText = (text: string) => {
    const id = `blk-${blockId++}`;
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: text });
    writer.write({ type: "text-end", id });
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

  if (
    wantsQuote &&
    ciudad &&
    fecha_recogida &&
    fecha_devolucion &&
    quoteIsStale
  ) {
    // First quote → requisitos once, then the table (both code-emitted).
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
        flags: { ...state.flags, quote_shown: true, last_quote_signature: sig },
      };
    } else {
      writeText(qr.message);
    }
  } else if (wantsQuote && !canQuote(state.slots)) {
    // Funnel: ask the next missing slot deterministically (no LLM).
    const q = nextQuoteQuestion(state.slots);
    if (q) writeText(q);
  } else {
    // Off-funnel: short, tool-enabled, free-form reply (the only generative text).
    const cfg = await freeFormConfig(brand);
    const prompt = `Datos conocidos del cliente: ${JSON.stringify(
      state.slots,
    )}\nMensaje actual: "${userMessage}"`;
    const result = streamText({ ...cfg, prompt });
    writer.merge(result.toUIMessageStream());
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
