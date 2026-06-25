import { openai } from "@ai-sdk/openai";
import { stepCountIs } from "ai";
import { buildChatTools } from "@/lib/chat/agent";
import { buildKnowledgeSection } from "@/lib/chat/faq";

/**
 * Short per-turn phrasing config for the orchestrator's free-form replies
 * (Rediseño híbrido · Etapa 2). Used ONLY for off-funnel messages (tangential
 * questions, objections, sede/gama/mensual questions) — the happy-path funnel
 * (greeting, requisitos, quote table) is deterministic code, not the LLM.
 *
 * The prompt is SHORT (the research showed giant prompts hurt obedience) and the
 * model is told NEVER to list prices/requisitos — those are emitted as fixed blocks
 * by code, so the model cannot re-paste them. That is why repetition disappears.
 */
const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-5";
const USES_GATEWAY = CHAT_MODEL.includes("/");

/** Short system prompt for a free-form reply. Grounded by the editable knowledge base. */
export async function freeFormSystem(): Promise<string> {
  const knowledge = await buildKnowledgeSection();
  return [
    "Eres Valeria, asesora virtual de alquiler de carros (español de Colombia, cálida y breve). Responde SOLO la pregunta o el mensaje ACTUAL del cliente, en 1–3 frases.",
    "NO saludes ni te presentes de nuevo. NO pegues la lista de precios ni el bloque de requisitos: el sistema los muestra aparte; si necesitas referir un precio, menciona en UNA línea solo la gama puntual.",
    "Precios, disponibilidad, sedes, gamas y tarifa mensual: SIEMPRE de las herramientas, nunca inventes.",
    "Sedes: nómbralas solo por su nombre corto (con `info_sedes`). NUNCA des la dirección exacta, NUNCA pongas mapas, NUNCA menciones al proveedor ('Localiza'). Horarios: solo si la hora que pide el cliente cae fuera del horario de la sede.",
    "Pago: único medio tarjeta de crédito (Visa/MasterCard/Amex). Alternativa: la tarjeta de un familiar/amigo presente al recoger, o que el cliente saque por su cuenta una tarjeta de crédito (incluida una virtual). NO des contactos ni teléfonos de asesores bancarios. NO menciones el filtro/validación de historial crediticio.",
    "NO escribas URLs ni enlaces tú misma.",
    "Mantente siempre en el tema de alquiler de carros de la marca.",
    "",
    knowledge,
  ].join("\n");
}

/** streamText config for a free-form reply: short prompt + the knowledge tools (no booking). */
export async function freeFormConfig(brand: string) {
  // Knowledge tools only — booking (crear_reserva) is the orchestrator's job (Etapa 3),
  // never reachable from the free-form phrasing path.
  const { crear_reserva: _omitBooking, ...tools } = buildChatTools(brand);
  void _omitBooking;
  return {
    model: USES_GATEWAY ? CHAT_MODEL : openai(CHAT_MODEL),
    system: await freeFormSystem(),
    tools,
    stopWhen: stepCountIs(4),
    ...(USES_GATEWAY
      ? {}
      : { providerOptions: { openai: { reasoningEffort: "low" as const } } }),
  };
}
