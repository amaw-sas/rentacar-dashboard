import { generateObject } from "ai";
import { z } from "zod";
import { chatModel, chatProviderOptions } from "@/lib/chat/model-config";
import { findGama } from "./quote-service";
import {
  extractionUpdates,
  INTENTS,
  type ConversationState,
  type Extraction,
} from "./slots";
import type { ExtractInput } from "./extract";

/**
 * The Controller (Controlador con contexto). Replaces the context-blind slot extractor when
 * CHAT_CONTROLLER=on. ONE LLM read per turn that sees the FULL picture — phase, every slot, the
 * quoted rows (numbered, with price AND model names), the gama in focus, and recent turns — and
 * returns a TYPED ACTION plus the reference resolved to a CONCRETE quoted row.
 *
 * Why it exists: the rigid extractor only set `gama_elegida` on an explicit code/name pick, so
 * deixis ("ese el blanco"), model names ("el Picanto"→C), labels ("la intermedia") and ambiguous
 * picks ("perfecto esa") fell through and the FSM booked the wrong gama ~1/3 of the time. The
 * Controller resolves those against the live table.
 *
 * The deterministic FSM/Executor still rules: this returns an {@link Extraction} the orchestrator
 * consumes UNCHANGED, and it only ever writes `gama_elegida` when the action is a real COMMIT to a
 * row that EXISTS in the quote — so it can never book a phantom gama, and a mere question about a
 * gama ("¿el Sandero cuánto vale?") never prematurely jumps the funnel to data collection.
 */

/** Typed actions the Controller classifies the turn into. Drives the commit gate; the rest is
 * advisory/observability (the FSM still decides flow from phase + intent). */
export const CONTROLLER_ACTIONS = [
  "ASK_SLOT", // a quote slot (ciudad/fecha) is missing
  "QUOTE", // ciudad + dates given/changed → wants a price
  "COMMIT_GAMA", // CHOOSES a specific gama to proceed (the one action that sets gama_elegida)
  "COLLECT_FIELD", // providing customer data
  "SHOW_SUMMARY", // ready for the booking summary
  "BOOK", // confirms the reservation ("sí, confírmala")
  "ANSWER", // an off-funnel question/objection (incl. asking ABOUT a gama, not choosing it)
  "ESCALATE", // wants a human advisor
] as const;
export type ControllerAction = (typeof CONTROLLER_ACTIONS)[number];

export const controllerSchema = z.object({
  /** What the latest message is doing (kept so the FSM switch is unchanged). */
  intent: z.enum(INTENTS),
  /** The typed action. COMMIT_GAMA is the ONLY one that commits a gama. */
  action: z.enum(CONTROLLER_ACTIONS),
  /** The gama the customer REFERS to, resolved to a quoted row's code (e.g. "C", "G4"), or null
   * when the message names no gama. MUST be one of the codes in the shown quote. */
  gama_code: z.string().nullable(),
  /** Slot values present/updated in THIS message (same vocabulary as the extractor). */
  updates: extractionUpdates,
});
export type ControllerObject = z.infer<typeof controllerSchema>;

const SYSTEM = [
  "Eres el CONTROLADOR de un chat de alquiler de carros en Colombia. NO converses; clasificas el último mensaje del cliente y extraes datos.",
  "Recibes la foto completa: fase del embudo, datos conocidos, la cotización mostrada (filas numeradas con código, descripción, precio y modelos), la gama en foco y la conversación reciente.",
  "Devuelves: intent, action, gama_code (resuelto a una fila REAL de la cotización o null) y updates (solo lo que el cliente menciona en ESTE mensaje; null en lo demás).",
  "",
  "RESOLUCIÓN DE REFERENCIAS (lo más importante). El cliente nombra la gama de formas indirectas; mapéala a una fila de la cotización mostrada:",
  "- Por posición: 'el primero'/'la primera' = fila 1; 'el segundo' = fila 2; 'el de la mitad'/'el del medio'/'el intermedio' = la fila central por precio; 'el último' = la última.",
  "- Por etiqueta: 'el más económico'/'el más barato' = la fila de menor precio (respeta transmisión/tipo si los pidió); 'la intermedia' = la del medio.",
  "- Por nombre de modelo: usa la lista de modelos de cada fila ('el Picanto'→la gama que lo lista; 'el Sandero'→su gama; 'la Duster'/'el Logan' igual).",
  "- Por deixis/contexto: 'ese'/'esa'/'ese mismo'/'perfecto esa'/'ese me sirve'/'esa me sirve'/'el blanco'/'el de la foto' = la gama EN FOCO. Te doy abajo las 'Gamas discutidas recientemente' (incluye lo que dijo Valeria en texto libre, p. ej. cuando cotizó 'la Gama LU' o 'la Gama CX'): el referente de 'ese/esa' es, por defecto, la MÁS RECIENTE de esa lista. Si el cliente nombró antes una gama específica y nunca la cambió (solo hizo preguntas), prefiere ESA. Si además dice 'el automático'/'la mecánica'/'la camioneta', úsalo para desambiguar.",
  "  SÉ DECISIVO: si el cliente AFIRMA sobre una gama discutida ('esa me sirve', 'esa está bien', 'resérvamela', 'me quedo con esa', 'listo esa') y hay una gama reciente clara, devuelve COMMIT_GAMA con su código — NO la dejes en null ni pidas que elija de nuevo. Solo deja gama_code=null si de verdad no se ha discutido ninguna gama.",
  "- Por categoría/transmisión: 'la camioneta'/'la SUV'/'un sedán automático' = la fila que cumpla esa clase y caja (la más barata si hay varias).",
  "gama_code SIEMPRE debe ser uno de los códigos de la cotización mostrada; si no puedes resolverla con confianza, pon null (NO inventes un código).",
  "",
  "ACCIÓN (action):",
  "- COMMIT_GAMA: úsala SOLO cuando el cliente ELIGE una gama para AVANZAR (la toma/se queda con ella/la confirma para reservar): 'me quedo con la C', 'esa me sirve', 'tomo el sedán', 'perfecto esa', 'reservemos la económica', 'listo ese me gusta'. Acompáñala con gama_code resuelto.",
  "- ANSWER: una PREGUNTA u objeción, AUNQUE mencione una gama ('¿el Sandero cuánto vale?', '¿esa es 4x4?', '¿tiene deducible?'). Aquí resuelve gama_code igual (para responder), pero NO es elección.",
  "- ASK_SLOT: falta ciudad o fechas. QUOTE: dio/cambió ciudad+fechas (u hora/sede) y quiere precio. COLLECT_FIELD: entrega datos personales. SHOW_SUMMARY: pide el resumen. BOOK: confirma la reserva ('sí, confírmala', 'hágale', 'resérvalo'). ESCALATE: pide un asesor humano.",
  "Distingue COMMIT_GAMA de BOOK: COMMIT_GAMA es escoger qué carro; BOOK es dar el sí final ya con gama y datos.",
  "",
  "EXTRACCIÓN DE SLOTS (en updates):",
  "- ciudad vs sede: `ciudad` es la CIUDAD de recogida; `sede` es SOLO el punto/sucursal dentro de esa ciudad (ej. 'aeropuerto', 'norte', 'chipichape', 'sur'), NUNCA una ciudad. CRÍTICO: si el cliente cambia el lugar de recogida a OTRA ciudad —o nombra un punto que está en otra ciudad (típico cuando la ciudad pedida no tiene sede y elige una cercana)— ACTUALIZA `ciudad` a esa nueva ciudad, AUNQUE ya hubiera una ciudad conocida (es algo nuevo, no lo dejes en null). ciudad y sede deben quedar coherentes. Ejemplo: si ya se conocía ciudad='tulua' y el cliente dice 'en palmira aeropuerto', devuelve ciudad='palmira' y sede='aeropuerto' (NUNCA dejes ciudad='tulua').",
  "- Fechas relativas ('mañana', 'el 27', 'este fin de semana') → YYYY-MM-DD usando la fecha de hoy dada. Horas en HH:mm 24h ('2pm'→'14:00').",
  "- transmision: 'mecanico' (mecánico/manual/sincrónico) o 'automatico'; si no la menciona, null.",
  "- tipo_vehiculo: 'camioneta' (camioneta/SUV/4x4/campero/todoterreno o 6+ personas/7 puestos) o 'auto' (sedán/hatchback/carro pequeño); si no, null.",
  "- cantidad: número SOLO si pide más de un vehículo ('2 carros'); no la confundas con fechas/horas/documento/edad/pasajeros.",
  "- cliente (fullname, identification_type CC/CE/PA, identification, email, phone): solo lo que aporte; si nada, null.",
  "- NO repitas en updates lo ya conocido; pon null en lo que no menciona. NO pongas gama_elegida en updates (la gama se decide por action+gama_code).",
].join("\n");

const COP = new Intl.NumberFormat("es-CO");

/**
 * Gama codes DISCUSSED in the recent turns, oldest→newest, deduped to last mention. Scans the
 * raw turn text (incl. Valeria's free-form, which surfaces gamas like "la Gama LU" that were never
 * committed to state) for "Gama <code>" matching the live quote. This is the deixis anchor: the
 * referent of a bare "ese/esa me sirve" is normally the most-recent of these — without it the
 * Controller was too conservative and left the pick unresolved, so the silent default booked C.
 */
function recentlyDiscussedGamas(
  recentContext: string[],
  userMessage: string,
  lastQuote: ConversationState["lastQuote"],
): string[] {
  if (!lastQuote) return [];
  const valid = new Map(
    lastQuote.filas.map((f) => [f.categoria.toLowerCase(), f.categoria]),
  );
  const order: string[] = [];
  const re = /\bgama\s+([a-z0-9]{1,3})\b/gi;
  // R1 · Bug 1: by default the anchor scans EVERY recent line incl. the bot's own
  // recommendation ("la Gama GC"), which then becomes the deixis target and books the wrong
  // gama. With CHAT_GAMA_INTEGRITY on, anchor only on what the CLIENT said (lines prefixed
  // `user:`) so "esa" refers to the customer's mention, not Valeria's suggestion.
  const lines =
    process.env.CHAT_GAMA_INTEGRITY === "on"
      ? recentContext.filter((l) => /^user:/i.test(l.trim()))
      : recentContext;
  for (const line of [...lines, `actual: ${userMessage}`]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const code = valid.get(m[1].toLowerCase());
      if (code) {
        const i = order.indexOf(code);
        if (i !== -1) order.splice(i, 1); // keep only the LATEST mention position
        order.push(code);
      }
    }
  }
  return order;
}

/** Build the Controller's context: phase + slots + numbered quote rows (price + models) +
 * focus gama + recent turns + today. This full picture is what the rigid extractor lacked. */
function buildContext(input: ExtractInput): string {
  const { state, recentContext, userMessage, todayYMD } = input;
  const s = state.slots;
  const parts: string[] = [
    `Hoy es ${todayYMD} (hora de Colombia).`,
    `Fase del embudo: ${state.phase}.`,
    `Datos ya conocidos: ${JSON.stringify(s)}`,
  ];

  if (state.lastQuote && state.lastQuote.filas.length) {
    const rows = state.lastQuote.filas
      .map((f, i) => {
        const models = state.modelsByGama?.[f.categoria];
        const modelStr =
          models && models.length ? ` — modelos: ${models.join(", ")}` : "";
        return `  ${i + 1}. Gama ${f.categoria} (${f.descripcion}) — $${COP.format(
          f.precioTotal,
        )}${modelStr}`;
      })
      .join("\n");
    parts.push(
      `Cotización mostrada (en orden por fila; el cliente puede referirse por número, código, modelo o etiqueta):\n${rows}`,
    );
    if (s.gama_elegida) {
      parts.push(`Gama en foco / elegida hasta ahora: ${s.gama_elegida}.`);
    }
    const recent = recentlyDiscussedGamas(
      recentContext,
      userMessage,
      state.lastQuote,
    );
    if (recent.length) {
      parts.push(
        `Gamas discutidas recientemente (antiguo→reciente): ${recent.join(
          ", ",
        )}. La más reciente es ${recent[recent.length - 1]} (referente probable de "ese/esa").`,
      );
    }
  } else {
    parts.push("Aún no se ha mostrado ninguna cotización.");
  }

  parts.push(
    recentContext.length
      ? `Conversación reciente (antiguo→nuevo):\n${recentContext.join("\n")}`
      : "Sin contexto previo.",
  );
  parts.push(`Mensaje actual del cliente: "${userMessage}"`);
  return parts.join("\n\n");
}

/** Result of a Controller run: the {@link Extraction} the orchestrator consumes, plus the raw
 * action/gama_code for logging. `updates.gama_elegida` is set ONLY on a validated COMMIT. */
export interface ControllerResult extends Extraction {
  action: ControllerAction;
  gamaCode: string | null;
}

/**
 * Run the Controller. Returns an {@link Extraction} (intent + updates) the orchestrator merges
 * exactly like the extractor's output, with one rule: `gama_elegida` is written ONLY when the
 * action is COMMIT_GAMA AND the resolved code exists in the live quote. Otherwise it stays null
 * (no premature commit, no phantom gama). Throws on a model/transport error — the caller (runTurn)
 * already degrades gracefully on a failed read.
 */
export async function runController(
  input: ExtractInput,
): Promise<ControllerResult> {
  const { object } = await generateObject({
    model: chatModel(),
    schema: controllerSchema,
    system: SYSTEM,
    prompt: buildContext(input),
    providerOptions: chatProviderOptions(),
  });

  const updates: ControllerObject["updates"] = { ...object.updates };
  // The commit gate: the FSM books whatever `gama_elegida` holds, so we set it ONLY on a real
  // pick that resolves to an existing quoted row. Everything else leaves it null — applyExtraction
  // drops nulls, so an existing focus/pick is preserved and a question never commits a gama.
  const committed = resolveCommit(input.state, object);
  updates.gama_elegida = committed;

  return {
    intent: object.intent,
    updates,
    action: object.action,
    gamaCode: object.gama_code,
  };
}

/** The gama code to COMMIT this turn, or null. Commit only when action=COMMIT_GAMA and the code
 * names a row that exists in the shown quote (defense against a hallucinated code). */
function resolveCommit(
  state: ConversationState,
  object: ControllerObject,
): string | null {
  if (object.action !== "COMMIT_GAMA" || !object.gama_code) return null;
  if (!state.lastQuote) return null;
  const row = findGama(state.lastQuote, object.gama_code);
  return row ? row.categoria : null;
}
