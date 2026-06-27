import { generateObject } from "ai";
import { chatModel, chatProviderOptions } from "@/lib/chat/model-config";
import {
  applyExtraction,
  extractionSchema,
  initialState,
  type ConversationState,
  type Extraction,
} from "./slots";
import {
  loadConversationState,
  saveConversationState,
} from "@/lib/chat/persistence";

/**
 * Slot extractor (Rediseño híbrido · Etapa 1). The ONE narrow LLM role: read the
 * latest user message in context and return {intent, slot updates} as a typed
 * object. This replaces the "understand the user" bulk of the old giant prompt; the
 * orchestrator (Etapa 2) decides flow from the result deterministically.
 *
 * Model + Gateway fallback resolution is shared via `@/lib/chat/model-config`.
 */
const SYSTEM = [
  "Eres un extractor de datos para un chat de alquiler de carros en Colombia. NO converses.",
  "Lee SOLO el último mensaje del cliente (con el contexto dado) y devuelve su intención y los datos que aporta.",
  "Reglas:",
  "- Resuelve fechas relativas ('mañana', 'este fin de semana', 'el 27') a YYYY-MM-DD usando la fecha de hoy dada.",
  "- Horas en formato HH:mm de 24h (ej. '2pm' → '14:00').",
  "- gama_elegida: SOLO cuando el cliente ELIGE una gama YA MOSTRADA, por su código (C, CX, F, FL, FU, FX, G4, GY, LE, LU) o nombre inequívoco. NO la infieras de una preferencia en la petición inicial ('quiero un económico' es una COTIZACIÓN, no una elección) ni inventes códigos que no existen (no hay gama 'E').",
  "- cantidad: si el cliente pide MÁS DE UN vehículo ('2 carros', 'dos camionetas', 'necesito 3 autos'), pon ese número en `cantidad`; si no menciona una cantidad de vehículos, null. NO la confundas con números de fechas, horas, documento, edad ni cantidad de pasajeros/puestos.",
  "- transmision: si el cliente indica caja, pon 'mecanico' (mecánico/manual/sincrónico) o 'automatico' (automático/automática); si no menciona la transmisión, null.",
  "- tipo_vehiculo: si pide 'camioneta', 'SUV', '4x4', 'campero', 'todoterreno', o capacidad grande (6+ personas, 7 puestos), pon 'camioneta'; si pide 'sedán', 'auto/carro pequeño' o 'hatchback', pon 'auto'; si no lo indica, null.",
  "- En `updates` pon SOLO los campos que el cliente menciona o cambia en este mensaje; usa null para todos los demás (no inventes ni repitas lo ya conocido).",
  "- Para datos del cliente usa `updates.cliente` (fullname, identification_type CC/CE/PA, identification, email, phone); si no aporta ninguno, `cliente` es null.",
].join("\n");

export interface ExtractInput {
  todayYMD: string;
  state: ConversationState;
  /** Recent conversation context (older→newer), plain text lines like "cliente: ...". */
  recentContext: string[];
  userMessage: string;
}

/** Run the extraction. Throws on a model/transport error — callers handle (shadow = best-effort). */
export async function extractSlots(input: ExtractInput): Promise<Extraction> {
  const known = JSON.stringify(input.state.slots);
  const prompt = [
    `Hoy es ${input.todayYMD} (hora de Colombia).`,
    `Datos ya conocidos (no los repitas, solo lo nuevo): ${known}`,
    input.recentContext.length
      ? `Contexto reciente:\n${input.recentContext.join("\n")}`
      : "Sin contexto previo.",
    `Mensaje actual del cliente: "${input.userMessage}"`,
  ].join("\n\n");

  const { object } = await generateObject({
    model: chatModel(),
    schema: extractionSchema,
    system: SYSTEM,
    prompt,
    providerOptions: chatProviderOptions(),
  });
  return object;
}

/**
 * Shadow-mode helper (Etapa 1): load state → extract from the latest message →
 * merge → persist. Used by the route when CHAT_ORCHESTRATOR=shadow to build state
 * alongside the live (still all-LLM) reply WITHOUT affecting it. Callers run it
 * best-effort (fire-and-forget) — any failure must not touch the user's response.
 */
export async function runShadowExtraction(params: {
  conversationId: string;
  todayYMD: string;
  recentContext: string[];
  userMessage: string;
}): Promise<void> {
  const current =
    (await loadConversationState(params.conversationId)) ?? initialState();
  const ext = await extractSlots({
    todayYMD: params.todayYMD,
    state: current,
    recentContext: params.recentContext,
    userMessage: params.userMessage,
  });
  await saveConversationState(params.conversationId, applyExtraction(current, ext));
}
