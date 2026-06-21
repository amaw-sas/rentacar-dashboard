import { tool, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import { buildKnowledgeSection } from "@/lib/chat/faq";
import { cotizarSchema, runCotizar } from "@/lib/chat/tools";

/**
 * Chatbot agent (V1). Single agent, single tool (`cotizar`), OpenAI gpt-5-mini.
 * The model id is the only line to change to swap tiers (e.g. gpt-5.4-mini for a
 * newer mini, gpt-5-nano to go cheaper, or gpt-5 for higher quality).
 *
 * V1 scope: quote (real Localiza prices) + answer FAQs + push the customer to a
 * reserve LINK. The bot does NOT create reservations.
 */
export const CHAT_MODEL = "gpt-5-mini";

/** Max tool-calling steps per turn (one quote round-trip + the reply). */
const MAX_STEPS = 4;

/** Tools exposed to the agent in V1. */
export const chatTools = {
  cotizar: tool({
    description:
      "Cotiza vehículos disponibles por ciudad y fechas con precios REALES. " +
      "Úsala SIEMPRE para dar precios — nunca inventes valores. Devuelve, por " +
      "gama, el precio en COP. Si la ciudad no existe, el resultado trae la " +
      "lista de ciudades válidas para que la ofrezcas al cliente.",
    inputSchema: cotizarSchema,
    execute: async (args) => {
      const result = await runCotizar(args);
      // Return a plain object either way; the LLM relays the ES message on error.
      return result.ok
        ? { disponibilidad: result.data }
        : { error: result.message };
    },
  }),
};

/**
 * Build the system prompt for a brand. Anchors "today" to Colombia time so the
 * LLM resolves relative dates ("este finde", "mañana") correctly, embeds the
 * authoritative FAQ knowledge, and carries the brand's reserve link.
 */
export function buildSystemPrompt(
  brand: string,
  now: Date = new Date(),
): string {
  const today = bogotaTodayYMD(now);
  const website = getFranchiseBranding(brand).website;

  return [
    "Eres el asesor virtual de alquiler de carros de la marca. Hablas español de Colombia: cálido, claro y directo. Tuteas al cliente.",
    "",
    `Hoy es ${today} (hora de Colombia, sin horario de verano). Usa esta fecha para resolver fechas relativas como "este fin de semana", "mañana" o "el próximo lunes" a fechas concretas YYYY-MM-DD.`,
    "",
    "QUÉ HACES:",
    "- Saludas, entiendes la necesidad y detectas la ciudad y las fechas.",
    "- Das precios REALES con la herramienta `cotizar`. NUNCA inventes precios ni disponibilidad.",
    "- Resuelves dudas frecuentes con el CONOCIMIENTO de abajo.",
    "- Tras cotizar, motivas a reservar y entregas el enlace de reserva.",
    "",
    "REGLAS:",
    "- Si falta la ciudad o las fechas, pregúntalas. No asumas ni cotices con datos incompletos.",
    "- Si la ciudad tiene varias sedes y es ambiguo, pregunta cuál sede prefiere.",
    "- Si `cotizar` devuelve un error con ciudades disponibles, ofrécelas al cliente.",
    "- En esta versión solo cotizas alquiler estándar (no mensualidades). Si piden 30 días o más, indícales que un asesor humano les ayuda con la tarifa mensual y comparte el enlace.",
    "- No creas la reserva tú: cuando el cliente quiera reservar, dirígelo a completar la reserva en el sitio.",
    `- Enlace de reserva de la marca: ${website}`,
    "- Mantente SIEMPRE en el tema de alquiler de carros de la marca. Si preguntan otra cosa, redirige con amabilidad.",
    "- Sé conciso. Montos en COP con separador de miles.",
    "",
    buildKnowledgeSection(),
  ].join("\n");
}

/** streamText options shared by the route. Caller passes the converted messages. */
export function buildStreamConfig(brand: string, messages: ModelMessage[]) {
  return {
    model: openai(CHAT_MODEL),
    system: buildSystemPrompt(brand),
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(MAX_STEPS),
  };
}
