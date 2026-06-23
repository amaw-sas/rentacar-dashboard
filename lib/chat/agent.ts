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
import { crearReservaSchema, runCrearReserva } from "@/lib/chat/reserva-tool";
import { buildFallbackLinks } from "@/lib/chat/reserva-link";
import { getLocationDirectory } from "@/lib/api/location-directory";
import type { PersistedMessage } from "@/lib/chat/persistence";

/**
 * Chatbot agent. OpenAI gpt-5-mini. The model id is the only line to change to
 * swap tiers.
 *
 * Knowledge model (Fase 2): structured TOOLS are the source of truth for prices
 * (cotizar), sedes (info_sedes), monthly rates (tarifa_mensual) and gamas
 * (info_gamas); the editable knowledge base injected into the prompt is FALLBACK.
 * Inc. 3: the bot can also CREATE the reservation (crear_reserva), gated by
 * CHAT_RESERVATIONS_ENABLED — off by default, so the public endpoint has no
 * booking side effect until Inc. 4 turns it on per brand.
 */
export const CHAT_MODEL = "gpt-5-mini";

/** Max tool-calling steps per turn (room for a quote/lookup/booking + the reply). */
const MAX_STEPS = 6;

/**
 * Max age of a quote before booking re-quotes instead of using it. The quote
 * itself never expires (decodeQuote has no TTL), but its price is frozen at
 * search time — booking a stale one risks charging an outdated rate. Default 1h,
 * overridable per environment. Reactive backstop: if Localiza rejects an old
 * token, the bot re-cotizes anyway (system prompt step 6).
 */
function quoteMaxAgeMs(): number {
  const hours = Number(process.env.CHAT_QUOTE_MAX_AGE_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 1) * 60 * 60 * 1000;
}

/** One quoted gama from the latest `cotizar` result, kept server-side. */
export interface ChatQuoteEntry {
  categoria: string;
  descripcion?: string;
  quote: string;
}

/** The latest cotizar result, resolved server-side so the LLM never echoes the quote. */
export interface LatestQuotes {
  quotedAtMs: number | null;
  entries: ChatQuoteEntry[];
}

/**
 * Extract the most recent `cotizar` result from persisted history so the server
 * can resolve `categoria → quote` itself. Walks newest-first and returns the
 * first assistant message carrying a completed `tool-cotizar` part. `quotedAtMs`
 * comes from that message's `created_at` (null for legacy rows → no age-check).
 */
export function extractLatestQuotes(history: PersistedMessage[]): LatestQuotes {
  for (let i = history.length - 1; i >= 0; i--) {
    const parts = history[i]?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const p = part as {
        type?: string;
        state?: string;
        output?: { disponibilidad?: { categorias?: unknown } };
      };
      if (p.type !== "tool-cotizar" || p.state !== "output-available") continue;
      const categorias = p.output?.disponibilidad?.categorias;
      if (!Array.isArray(categorias)) continue;
      const entries: ChatQuoteEntry[] = [];
      for (const c of categorias) {
        const row = c as {
          categoria?: unknown;
          descripcion?: unknown;
          quote?: unknown;
        };
        if (typeof row.categoria === "string" && typeof row.quote === "string") {
          entries.push({
            categoria: row.categoria,
            descripcion:
              typeof row.descripcion === "string" ? row.descripcion : undefined,
            quote: row.quote,
          });
        }
      }
      if (entries.length === 0) continue;
      const ts = history[i]?.created_at;
      const quotedAtMs = ts ? Date.parse(ts) : NaN;
      return {
        quotedAtMs: Number.isFinite(quotedAtMs) ? quotedAtMs : null,
        entries,
      };
    }
  }
  return { quotedAtMs: null, entries: [] };
}

/** Resolve a gama the LLM named to its stored quote: exact code, then descripcion. */
function resolveQuote(
  latest: LatestQuotes | undefined,
  categoria: string,
): string | undefined {
  if (!latest || latest.entries.length === 0) return undefined;
  const norm = categoria.trim().toLowerCase();
  const exact = latest.entries.find(
    (e) => e.categoria.trim().toLowerCase() === norm,
  );
  if (exact) return exact.quote;
  const byDesc = latest.entries.find((e) =>
    (e.descripcion ?? "").toLowerCase().includes(norm),
  );
  return byDesc?.quote;
}

export type BookingResolution =
  | { ok: true; quote: string }
  | { ok: false; error: string };

/**
 * Decide the quote to book with, server-side (`nowMs` injected for testability):
 * resolve the LLM-named gama to its stored quote and reject a stale one. The two
 * error paths read naturally because the bot relays them verbatim, then re-cotizes.
 */
export function resolveBookingQuote(
  latestQuotes: LatestQuotes | undefined,
  categoria: string,
  nowMs: number,
): BookingResolution {
  const quote = resolveQuote(latestQuotes, categoria);
  if (!quote) {
    return {
      ok: false,
      error:
        "No tengo a la mano la cotización de esa gama. Déjame cotizar de nuevo.",
    };
  }
  if (
    latestQuotes?.quotedAtMs != null &&
    nowMs - latestQuotes.quotedAtMs > quoteMaxAgeMs()
  ) {
    return {
      ok: false,
      error:
        "Tu cotización ya tiene un rato; déjame actualizar el precio antes de reservar.",
    };
  }
  return { ok: true, quote };
}

/**
 * Build the tools exposed to the agent for a given brand. A function (not a
 * static object) so `crear_reserva` can inject `franchise = brand` AND the
 * resolved `quote` server-side — the LLM never supplies either.
 */
export function buildChatTools(brand: string, latestQuotes?: LatestQuotes) {
  return {
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
    crear_reserva: tool({
      description:
        "Crea la reserva REAL: indica la `categoria` (código de gama) que el cliente " +
        "eligió más sus datos. Llama esto SOLO después de resumir la reserva y recibir " +
        "una confirmación EXPLÍCITA del cliente. Devuelve el número de solicitud.",
      inputSchema: crearReservaSchema,
      execute: async (args) => {
        // Gated: off by default so the public endpoint never books until Inc. 4
        // enables it per brand. Degrades to today's behavior (push to the site).
        if (process.env.CHAT_RESERVATIONS_ENABLED !== "true") {
          const website = getFranchiseBranding(brand).website;
          return {
            error: `Por ahora la reserva se completa en el sitio: ${website}`,
          };
        }

        // Resolve the quote server-side (the LLM only named the gama) and reject a
        // stale price. Either error is relayed verbatim → the bot re-cotizes.
        const resolved = resolveBookingQuote(
          latestQuotes,
          args.categoria,
          Date.now(),
        );
        if (!resolved.ok) return { error: resolved.error };

        const result = await runCrearReserva({
          quote: resolved.quote,
          fullname: args.fullname,
          identification_type: args.identification_type,
          identification: args.identification,
          email: args.email,
          phone: args.phone,
          franchise: brand,
        });
        if (result.ok) return result.data;

        // Booking failed for real (provider down / no availability). Don't loop —
        // hand the customer pre-filled fallback links so the lead isn't lost.
        // Best-effort: any failure resolving them degrades to just the message.
        let links: { webUrl: string; whatsappUrl: string } | null = null;
        try {
          const directory = await getLocationDirectory();
          links = buildFallbackLinks(
            {
              brand,
              quote: resolved.quote,
              gamaDescripcion: latestQuotes?.entries.find(
                (e) =>
                  e.categoria.trim().toLowerCase() ===
                  args.categoria.trim().toLowerCase(),
              )?.descripcion,
              customer: {
                fullname: args.fullname,
                identification_type: args.identification_type,
                identification: args.identification,
                email: args.email,
                phone: args.phone,
              },
            },
            directory,
          );
        } catch (e) {
          console.error("[chat] buildFallbackLinks failed", e);
        }
        return links
          ? {
              error: result.message,
              completar_en_web: links.webUrl,
              whatsapp_asesor: links.whatsappUrl,
            }
          : { error: result.message };
      },
    }),
  };
}

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
  // Current Colombia time so the bot never proposes a pickup hour that already
  // passed today (Localiza rejects past pickup datetimes with LLNRRE002).
  const nowHM = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const website = getFranchiseBranding(brand).website;
  const knowledge = await buildKnowledgeSection();

  return [
    "Eres Valeria, la asesora virtual de alquiler de carros de la marca: una asistente con IA disponible 24/7. Si te preguntan, eres transparente —eres virtual, no humana— sin perder calidez. Hablas español de Colombia: cálida, clara y directa. Tuteas al cliente. Refiérete a ti misma SIEMPRE en femenino (\"encantada\", \"atenta\", \"lista para ayudarte\"); nunca alternes el género.",
    "",
    `Hoy es ${today} y son las ${nowHM} (hora de Colombia, sin horario de verano). Usa esta fecha para resolver fechas relativas como "este fin de semana", "mañana" o "el próximo lunes" a fechas concretas YYYY-MM-DD.`,
    `IMPORTANTE con la hora: la recogida no puede ser en el pasado. Si el cliente pide hoy a una hora que YA pasó (anterior a ${nowHM}), NO cotices con esa hora: avísale con amabilidad y ofrécele una hora más tarde de hoy o el día siguiente.`,
    "",
    "QUÉ HACES:",
    "- Saludas, entiendes la necesidad y detectas la ciudad y las fechas.",
    "- Das precios REALES con la herramienta `cotizar`. NUNCA inventes precios ni disponibilidad.",
    "- Resuelves dudas de sedes, gamas y tarifa mensual con las herramientas.",
    "- Cuando el cliente quiere reservar, tomas sus datos y creas la reserva con `crear_reserva`.",
    "",
    "HERRAMIENTAS Y FUENTE DE VERDAD (regla de precedencia):",
    "- Usa SIEMPRE las herramientas como verdad: `cotizar` (precios/disponibilidad), `info_sedes` (sedes, direcciones, horarios), `tarifa_mensual` (precios por mes por gama), `info_gamas` (atributos de gamas).",
    "- La sección CONOCIMIENTO de abajo es RESPALDO: úsala para políticas, requisitos, objeciones, libreto y tono, o cuando una herramienta no devuelva el dato.",
    "- Si una herramienta y el CONOCIMIENTO se contradicen, GANA la herramienta. Nunca inventes datos que una herramienta podría darte.",
    "",
    "CÓMO RESERVAS (flujo de cierre):",
    "- Solo después de cotizar y cuando el cliente quiera reservar una gama concreta:",
    "  1) Pide de forma natural (uno o dos a la vez, no como formulario): nombre completo, tipo y número de documento (CC, CE o PA), correo y teléfono. Si el cliente ya dio algún dato, no lo vuelvas a pedir.",
    "  2) RESUME la reserva: gama elegida, fechas, sede de recogida (usa `info_sedes`), valor total con descuento, y los datos del cliente.",
    "  3) Pide confirmación EXPLÍCITA ('¿Confirmo tu reserva?'). NO llames `crear_reserva` sin un sí claro.",
    "  4) Llama `crear_reserva` indicando la `categoria` (el CÓDIGO de gama, ej. 'C') que el cliente eligió, tal como apareció en `cotizar`. El sistema usa la cotización guardada — NO necesitas el `quote`. En el turno de confirmación NO vuelvas a llamar `cotizar` ni `info_sedes`: ve directo a `crear_reserva`.",
    "  5) Al recibir el número de solicitud, entrégaselo y recuérdale: la recogida es en un local Localiza (dale nombre, dirección y mapa con `info_sedes`); requisitos (tarjeta de crédito física, documento de identidad, licencia vigente); el pago es en la sede, no anticipado.",
    "  6) Si `crear_reserva` pide actualizar el precio (cotización antigua), vuelve a cotizar las mismas fechas y sede; si el precio cambió, INFÓRMASELO al cliente y pide confirmación de nuevo antes de reservar. Si falla por error del proveedor, reintenta UNA sola vez; si vuelve a fallar y la herramienta te devuelve `completar_en_web`/`whatsapp_asesor`, discúlpate breve, NO reintentes más y dile que abajo le dejas dos opciones para terminar (en la web o con un asesor por WhatsApp). IMPORTANTE: NUNCA escribas URLs ni enlaces tú misma ni los inventes — el sistema muestra los botones automáticamente a partir de la respuesta de la herramienta.",
    "- Para confirmar solo necesitas la `categoria`; NO re-cotices solo para confirmar. Re-cotiza únicamente si el cliente cambió la ciudad, las fechas o la gama, o si `crear_reserva` te lo pide.",
    "",
    "REGLAS:",
    "- Si falta la ciudad o las fechas, pregúntalas. No asumas ni cotices con datos incompletos.",
    "- Si la ciudad tiene varias sedes y es ambiguo, pregunta cuál sede prefiere (usa `info_sedes`).",
    "- Si una herramienta devuelve un error con opciones (ciudades/gamas válidas), ofrécelas al cliente.",
    "- Alquiler por mes (30+ días): da la tarifa de referencia con `tarifa_mensual` y aclara que el kilometraje es limitado (1000/2000 km) y se pide mín. 7 días de anticipación.",
    `- Enlace de reserva de la marca: ${website}`,
    "- Mantente SIEMPRE en el tema de alquiler de carros de la marca. Si preguntan otra cosa, redirige con amabilidad.",
    "- Sé concisa. Montos en COP con separador de miles.",
    "- Comparte el bloque COMPLETO de requisitos UNA sola vez (al inicio o cuando el cliente pregunte). Después menciona solo el requisito puntual que aplique al momento; NO reenvíes el bloque entero en cada mensaje.",
    "- NO uses menús de opciones (ni 'A/B/C' ni listas numeradas de acciones). Haz UNA pregunta natural a la vez y empuja hacia el siguiente paso concreto.",
    "",
    "MANEJO DE OBJECIONES CLAVE (no pierdas el lead):",
    "- Pago: el ÚNICO medio es tarjeta de crédito física (Visa/MasterCard/Amex). Dilo temprano y ofrece de una la alternativa: puede ser la tarjeta de un familiar/amigo presente al recoger, o sacar una tarjeta de crédito virtual el mismo día. No insistas más de dos veces.",
    "- Filtro crediticio: en la sede se valida historial crediticio al recoger; una reserva por chat puede ser rechazada presencialmente. Menciónalo UNA sola vez, en tono neutro e informativo (no como advertencia repetida); no lo repitas turno a turno.",
    "- Precio web vs real: el valor de la web NO incluye impuestos y algunos precios del catálogo son por mes; el valor real con todo incluido es el que entregas tú con `cotizar`.",
    "",
    knowledge,
  ].join("\n");
}

/** streamText options shared by the route. Caller passes the converted messages. */
export async function buildStreamConfig(
  brand: string,
  messages: ModelMessage[],
  latestQuotes?: LatestQuotes,
) {
  return {
    model: openai(CHAT_MODEL),
    system: await buildSystemPrompt(brand),
    messages,
    tools: buildChatTools(brand, latestQuotes),
    stopWhen: stepCountIs(MAX_STEPS),
  };
}
