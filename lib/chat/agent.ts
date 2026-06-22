import { tool, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import { buildKnowledgeSection } from "@/lib/chat/faq";
import { cotizarSchema, runCotizar } from "@/lib/chat/tools";
import {
  infoSedesSchema,
  runInfoSedes,
  tarifaMensualSchema,
  runTarifaMensual,
  infoGamasSchema,
  runInfoGamas,
} from "@/lib/chat/knowledge-tools";

/**
 * Chatbot agent. OpenAI gpt-5-mini. The model id is the only line to change to
 * swap tiers.
 *
 * Knowledge model (Fase 2 · Incremento 2): structured TOOLS are the source of
 * truth for prices (cotizar), sedes (info_sedes), monthly rates (tarifa_mensual)
 * and gamas (info_gamas). The editable knowledge base injected into the prompt is
 * FALLBACK for everything else (policies, requirements, objections, tone). The
 * bot quotes and pushes the customer to a reserve LINK; it does NOT create
 * reservations (that's Incremento 3).
 */
export const CHAT_MODEL = "gpt-5-mini";

/** Max tool-calling steps per turn (room for a quote/lookup + the reply). */
const MAX_STEPS = 5;

/** Tools exposed to the agent. */
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
      return result.ok
        ? { disponibilidad: result.data }
        : { error: result.message };
    },
  }),
  info_sedes: tool({
    description:
      "Devuelve las sedes (puntos de recogida) de una ciudad: nombre, dirección, " +
      "mapa y horario. Úsala para responder dónde recoger, a qué hora abren, o " +
      "qué sedes hay. Si la ciudad no existe, trae la lista de ciudades válidas.",
    inputSchema: z.object(infoSedesSchema),
    execute: async (args) => runInfoSedes(args),
  }),
  tarifa_mensual: tool({
    description:
      "Devuelve la tarifa MENSUAL de referencia de una gama (precios por 1000/" +
      "2000/3000 km y seguro). Úsala cuando pregunten por alquiler por mes o por " +
      "30+ días. La tarifa es nacional (no varía por ciudad) y el kilometraje es " +
      "limitado.",
    inputSchema: z.object(tarifaMensualSchema),
    execute: async (args) => runTarifaMensual(args),
  }),
  info_gamas: tool({
    description:
      "Devuelve las gamas de vehículos y sus atributos (pasajeros, maletas, aire, " +
      "transmisión, sin pico y placa). Úsala para '¿qué carros tienen?', " +
      "'¿automático?', '¿el más espacioso?'. Recuerda: se alquila por gama, no " +
      "por modelo.",
    inputSchema: z.object(infoGamasSchema),
    execute: async (args) => runInfoGamas(args),
  }),
};

/**
 * Build the system prompt for a brand. Anchors "today" to Colombia time, embeds
 * the editable knowledge base (async DB read, fallback inside), and carries the
 * brand's reserve link. Async because the knowledge section is read at request
 * time so dashboard edits take effect without a deploy.
 */
export async function buildSystemPrompt(
  brand: string,
  now: Date = new Date(),
): Promise<string> {
  const today = bogotaTodayYMD(now);
  const website = getFranchiseBranding(brand).website;
  const knowledge = await buildKnowledgeSection();

  return [
    "Eres el asesor virtual de alquiler de carros de la marca. Hablas español de Colombia: cálido, claro y directo. Tuteas al cliente.",
    "",
    `Hoy es ${today} (hora de Colombia, sin horario de verano). Usa esta fecha para resolver fechas relativas como "este fin de semana", "mañana" o "el próximo lunes" a fechas concretas YYYY-MM-DD.`,
    "",
    "QUÉ HACES:",
    "- Saludas, entiendes la necesidad y detectas la ciudad y las fechas.",
    "- Das precios REALES con la herramienta `cotizar`. NUNCA inventes precios ni disponibilidad.",
    "- Resuelves dudas de sedes, gamas y tarifa mensual con las herramientas.",
    "- Tras cotizar, motivas a reservar y entregas el enlace de reserva.",
    "",
    "HERRAMIENTAS Y FUENTE DE VERDAD (regla de precedencia):",
    "- Usa SIEMPRE las herramientas como verdad: `cotizar` (precios/disponibilidad), `info_sedes` (sedes, direcciones, horarios), `tarifa_mensual` (precios por mes por gama), `info_gamas` (atributos de gamas).",
    "- La sección CONOCIMIENTO de abajo es RESPALDO: úsala para políticas, requisitos, objeciones, libreto y tono, o cuando una herramienta no devuelva el dato.",
    "- Si una herramienta y el CONOCIMIENTO se contradicen, GANA la herramienta. Nunca inventes datos que una herramienta podría darte.",
    "",
    "REGLAS:",
    "- Si falta la ciudad o las fechas, pregúntalas. No asumas ni cotices con datos incompletos.",
    "- Si la ciudad tiene varias sedes y es ambiguo, pregunta cuál sede prefiere (usa `info_sedes`).",
    "- Si una herramienta devuelve un error con opciones (ciudades/gamas válidas), ofrécelas al cliente.",
    "- Alquiler por mes (30+ días): da la tarifa de referencia con `tarifa_mensual` y aclara que el kilometraje es limitado (1000/2000 km) y se pide mín. 7 días de anticipación.",
    "- No creas la reserva tú: cuando el cliente quiera reservar, dirígelo a completar la reserva en el sitio. Recuérdale que el punto de recogida es un local Localiza (te lo da `info_sedes`: nombre, dirección y mapa).",
    `- Enlace de reserva de la marca: ${website}`,
    "- Mantente SIEMPRE en el tema de alquiler de carros de la marca. Si preguntan otra cosa, redirige con amabilidad.",
    "- Sé conciso. Montos en COP con separador de miles.",
    "",
    "MANEJO DE OBJECIONES CLAVE (no pierdas el lead):",
    "- Pago: el ÚNICO medio es tarjeta de crédito física (Visa/MasterCard/Amex). Dilo temprano y ofrece de una la alternativa: puede ser la tarjeta de un familiar/amigo presente al recoger, o sacar una tarjeta de crédito virtual el mismo día. No insistas más de dos veces.",
    "- Filtro crediticio: en la sede se valida historial crediticio al recoger; una reserva por chat puede ser rechazada presencialmente. Fija esa expectativa para evitar sorpresas.",
    "- Precio web vs real: el valor de la web NO incluye impuestos y algunos precios del catálogo son por mes; el valor real con todo incluido es el que entregas tú con `cotizar`.",
    "",
    knowledge,
  ].join("\n");
}

/** streamText options shared by the route. Caller passes the converted messages. */
export async function buildStreamConfig(
  brand: string,
  messages: ModelMessage[],
) {
  return {
    model: openai(CHAT_MODEL),
    system: await buildSystemPrompt(brand),
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(MAX_STEPS),
  };
}
