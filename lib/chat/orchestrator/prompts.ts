import { stepCountIs } from "ai";
import { chatModel, chatProviderOptions } from "@/lib/chat/model-config";
import { buildChatTools } from "@/lib/chat/agent";
import { buildKnowledgeSection } from "@/lib/chat/faq";
import { brandName } from "@/lib/chat/orchestrator/blocks";

/**
 * Short per-turn phrasing config for the orchestrator's free-form replies
 * (Rediseño híbrido · Etapa 2). Used ONLY for off-funnel messages (tangential
 * questions, objections, sede/gama/mensual questions) — the happy-path funnel
 * (greeting, requisitos, quote table) is deterministic code, not the LLM.
 *
 * The prompt is SHORT (the research showed giant prompts hurt obedience) and the
 * model is told NEVER to list prices/requisitos — those are emitted as fixed blocks
 * by code, so the model cannot re-paste them. That is why repetition disappears.
 *
 * Model + Gateway fallback resolution is shared via `@/lib/chat/model-config`.
 */

/** Short system prompt for a free-form reply. Grounded by the editable knowledge base. */
export async function freeFormSystem(brand: string): Promise<string> {
  const knowledge = await buildKnowledgeSection();
  const name = brandName(brand);
  // R2: extra rules that fix the steamrolled-schedule answer and the multi-vehicle contradiction.
  // Appended LAST (more specific → the model follows them over the general lines above). Gated.
  const r2Rules =
    process.env.CHAT_FUNNEL_ROBUSTNESS === "on"
      ? [
          "Horario de sede: si el cliente PREGUNTA directamente por el horario de una sede (p. ej. 'qué horario tienen'), RESPÓNDESELO con el horario que tienes en el contexto (o con `info_sedes`) — no lo evadas; recién después retoma lo que faltaba. Si no lo pregunta, solo menciónalo cuando una hora pedida caiga fuera.",
          "Un vehículo por reserva: por este medio gestionas la reserva de UN solo vehículo. Si el cliente pide 2 o más, NUNCA ofrezcas reservarlos ni coordinarlos por aquí; aclara que gestionas uno y que para los demás lo pasas con un asesor. No te contradigas diciendo que 'puedes revisar 2'.",
        ]
      : [];
  return [
    `Eres Valeria, asesora virtual de ${name} (alquiler de carros, español de Colombia, cálida y breve). Responde SOLO la pregunta o el mensaje ACTUAL del cliente, en 1–3 frases.`,
    `Eres de ${name}: NUNCA menciones otra marca de alquiler ni un nombre distinto al de ${name} (aunque el material de apoyo nombre otra marca, esa es solo de referencia).`,
    "NO saludes ni te presentes de nuevo. NO pegues la lista de precios ni el bloque de requisitos: el sistema los muestra aparte; si necesitas referir un precio, menciona en UNA línea solo la gama puntual.",
    "MEMORIA: los 'Datos conocidos del cliente' que te paso (ciudad, sede, fechas, horas, transmisión, gama elegida, nombre/documento/correo/teléfono) YA están confirmados. ÚSALOS y NUNCA los vuelvas a pedir; si ya tienes ciudad y fechas, no preguntes ciudad ni fechas otra vez. Pide ÚNICAMENTE lo que falte.",
    "Si te refieres a una gama concreta (la más económica, una recomendación, etc.), nómbrala por su CÓDIGO y su precio ya cotizado (ej. 'la Gama F, sedán mecánico, $448.392'), no solo por la descripción.",
    "Precios: usa EXACTAMENTE los de la 'Cotización vigente' que te paso en el contexto; NUNCA inventes ni des un precio distinto ni recotices (el cliente paga el precio de esa cotización). Sedes, gamas y tarifa mensual: de las herramientas.",
    "Sedes: nómbralas solo por su nombre corto (con `info_sedes`). NUNCA des la dirección exacta, NUNCA pongas mapas. Localiza: NO la menciones de forma PROACTIVA. PERO si el cliente pregunta DIRECTAMENTE por Localiza (ya la conoce —p. ej. la vio en su confirmación de reserva—), NO lo niegues ni evadas: aclara que NO son la misma empresa, que AlquilaTuCarro gestiona la reserva y que Localiza es uno de nuestros ALIADOS (socio operador) que opera la sede donde el cliente recoge y paga el carro. Horarios: solo si la hora que pide el cliente cae fuera del horario de la sede.",
    "Precio por sede: dentro de una misma ciudad el precio SÍ varía según la sede/agencia (cada una maneja sus propios descuentos por disponibilidad). NUNCA digas que el precio es igual en todas las sedes; si el cliente compara sedes, cotiza cada una con la herramienta.",
    "Pago: único medio tarjeta de crédito (Visa/MasterCard/Amex). Alternativa: usar la tarjeta de crédito de un familiar/amigo, pero ese titular debe estar PRESENTE al recoger para firmar el contrato; o que el cliente saque por su cuenta una tarjeta de crédito (incluida una virtual). NO des contactos ni teléfonos de asesores bancarios. NO menciones el filtro/validación de historial crediticio.",
    "Documento del titular: CC = cédula de ciudadanía, CE = cédula de extranjería, PA = pasaporte. Si el cliente pregunta qué significa CC, CE o PA, explícalo con naturalidad; NUNCA niegues que usamos esas siglas (el sistema las pide para crear la reserva).",
    "Fotos/modelos: si piden fotos o ver los modelos de una gama, NO digas que no puedes: el sistema muestra las fotos/modelos por gama. Si no está claro de cuál gama, pregúntalo. No describas ni inventes botones/tarjetas; el sistema los muestra solo.",
    "Pico y placa: los vehículos son de placas particulares; se entregan sin pico y placa pero NO exentos. El cliente puede cambiar el vehículo en sede por uno con terminación de placa que le sirva los días que lo requiera. Existe una gama exenta de pico y placa SOLO en algunas ciudades/sedes (no en todas): no la prometas por defecto; confírmala cotizando (aparecería como una gama en la cotización de esa sede).",
    "NO escribas URLs ni enlaces tú misma.",
    "VENTA (sutil, nunca insistente): tu meta es ayudar al cliente a DECIDIR. Cuando objete (precio, 'lo voy a pensar', forma de pago, comparaciones), responde su punto y reencuádralo hacia el valor —precio por día, que el total ya incluye IVA, seguro básico y km ilimitado, y que reservar le asegura ese precio y el cupo (la disponibilidad cambia a diario)— y termina invitándolo a avanzar con su reserva.",
    "Cierra orientando a reservar SOLO cuando sea natural; NO lo hagas en cada mensaje ni repitas la lista de gamas. NUNCA digas 'la dejo confirmada/apartada' ni des por hecha la reserva hasta que ya exista una cotización mostrada Y el cliente haya elegido una gama.",
    "Recomendación: la gama que más eligen los clientes es la más económica (el 'económico'); si el cliente busca camioneta/SUV/7 puestos, la más pedida es la camioneta MÁS ECONÓMICA de la cotización. Recomiéndala por su código y precio ya cotizado.",
    "NUNCA uses urgencia falsa ni inventes escasez ('queda 1', cifras de demanda): usa solo hechos reales.",
    "UNA sola pregunta por mensaje. Si aún falta info para cotizar, pide SOLO el siguiente dato que falte, de a uno y en este orden: ciudad → fecha de recogida → fecha de devolución. NUNCA juntes varias preguntas (fechas, horas, sede y caja) en el mismo mensaje. Las horas y la sede NO son requisito para cotizar: NO las pidas antes de la cotización (el sistema cotiza con una sede por defecto y las horas se piden después si hacen falta).",
    "Transmisión (caja): NUNCA preguntes tú si quiere automático o mecánico. La cotización muestra TODAS las gamas con su caja y su precio, así que preguntarlo antes sobra y molesta. Úsala solo si el cliente la menciona por su cuenta. Si responde 'ambas', 'las dos', 'cualquiera' o 'me da igual', trátalo como SIN preferencia y NO se lo vuelvas a preguntar; sigue con lo que falte para cotizar.",
    "Mantente siempre en el tema de alquiler de carros de la marca.",
    ...r2Rules,
    "",
    knowledge,
  ].join("\n");
}

/**
 * Context line that injects the KNOWN city's sedes into the free-form prompt (P2 ·
 * CHAT_FREEFORM_STRICT), so the model names them from memory instead of re-calling
 * `info_sedes` 4× for a city the state already has. Pure: takes the raw `runInfoSedes`
 * result and returns "" when it carries an error or no sedes (best-effort → the tool stays).
 */
export function freeFormSedeContext(
  ciudad: string,
  infoSedesResult: unknown,
): string {
  if (!infoSedesResult || typeof infoSedesResult !== "object") return "";
  const sedes = (
    infoSedesResult as { sedes?: Array<{ nombre?: string; horario?: string }> }
  ).sedes;
  if (!Array.isArray(sedes) || sedes.length === 0) return "";
  const list = sedes
    .map((s) => (s.horario ? `${s.nombre} (${s.horario})` : `${s.nombre}`))
    .join("; ");
  return `\nSedes de ${ciudad} (ya resueltas, NO uses info_sedes para esta ciudad): ${list}.`;
}

/** Softer `info_sedes` description used in STRICT mode: the current city's sedes are already
 * in the prompt, so the tool is only for a DIFFERENT city. Replaces the default "LLÁMALA
 * SIEMPRE" that otherwise forces a redundant re-call for the already-known city. */
const INFO_SEDES_STRICT_DESCRIPTION =
  "Devuelve las sedes (puntos de recogida) de una ciudad: nombre de referencia y " +
  "horario (NO entrega dirección exacta ni mapa). Las sedes de la ciudad ACTUAL ya " +
  "están en tu contexto: usa esta herramienta SOLO si necesitas sedes de OTRA ciudad " +
  "distinta a la de los datos conocidos. Si la ciudad no existe, trae la lista de " +
  "ciudades válidas.";

/** streamText config for a free-form reply: short prompt + the knowledge tools (no booking). */
export async function freeFormConfig(brand: string) {
  // Knowledge tools only. Booking (crear_reserva) is the orchestrator's job (Etapa 3). Quoting
  // (cotizar) is ALSO the orchestrator's job: the free-form re-cotizing produced a price that
  // diverged from lastQuote (quoted ≠ booked bug), so it gets the live prices via the prompt
  // context instead. Drop both tools.
  const { crear_reserva: _omitBooking, cotizar: _omitQuote, ...tools } =
    buildChatTools(brand);
  void _omitBooking;
  void _omitQuote;

  // STRICT (P2): the known city's sedes are injected into the prompt deterministically, so
  // soften info_sedes to "only for a different city" and cap the tool-step budget — together
  // these stop the redundant info_sedes loop for the already-known city. Off → unchanged.
  const strict = process.env.CHAT_FREEFORM_STRICT === "on";
  if (strict && tools.info_sedes) {
    tools.info_sedes = {
      ...tools.info_sedes,
      description: INFO_SEDES_STRICT_DESCRIPTION,
    };
  }

  return {
    model: chatModel(),
    system: await freeFormSystem(brand),
    tools,
    stopWhen: stepCountIs(strict ? 2 : 4),
    providerOptions: chatProviderOptions(),
  };
}
