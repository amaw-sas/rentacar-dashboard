import { z } from "zod";

/**
 * Conversation state model for the hybrid orchestrator (Rediseño híbrido · Etapa 1).
 *
 * The state is the server-owned source of truth for WHERE the conversation is and
 * WHAT is known. The LLM never decides flow from this — code does (Etapa 2). Here we
 * only define the shape, the LLM EXTRACTION schema (the one place the model "reads"
 * the conversation), and a pure merge. Stored as `chat_conversations.state` (jsonb).
 */

/** Funnel phases. The orchestrator (Etapa 2) transitions between these. */
export const PHASES = [
  "greeting",
  "collecting", // gathering ciudad/fechas/horas/sede before a quote
  "quoted",
  "choosing_gama",
  "collecting_customer",
  "confirming",
  "booked",
  "fallback",
] as const;
export type Phase = (typeof PHASES)[number];

/** What the user's latest message is trying to do. Drives the orchestrator switch. */
export const INTENTS = [
  "saludo",
  "cotizar", // give/confirm ciudad+fechas, wants a price
  "elige_gama",
  "da_datos", // provides customer data
  "confirma_reserva",
  "pregunta_sede",
  "pregunta_gama",
  "pregunta_mensual",
  "pregunta_horas_extra",
  "objecion", // pago/tarjeta/precio-web objections
  "pedir_enlace", // wants a reservation link to self-serve
  "hablar_asesor", // wants the brand's WhatsApp advisor
  "tangencial", // small off-flow question (foto, gasolina, seguro, ...)
  "fuera_de_tema",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface ClienteSlots {
  fullname?: string;
  identification_type?: string;
  identification?: string;
  email?: string;
  phone?: string;
}

export interface Slots {
  ciudad?: string;
  sede?: string;
  fecha_recogida?: string; // YYYY-MM-DD
  fecha_devolucion?: string; // YYYY-MM-DD
  hora_recogida?: string; // HH:mm
  hora_devolucion?: string; // HH:mm
  gama_elegida?: string; // gama code, e.g. "C"
  cliente: ClienteSlots;
}

export interface ConversationFlags {
  greeted: boolean;
  requisitos_shown: boolean;
  quote_shown: boolean;
  /** Hash of (ciudad,sede,fechas,horas) of the last quote shown — detects when a re-cotizar is needed. */
  last_quote_signature?: string;
}

export interface ConversationState {
  phase: Phase;
  slots: Slots;
  flags: ConversationFlags;
}

export function initialState(): ConversationState {
  return {
    phase: "greeting",
    slots: { cliente: {} },
    flags: { greeted: false, requisitos_shown: false, quote_shown: false },
  };
}

// ---------------------------------------------------------------------------
// LLM extraction schema — the ONLY place the model reads the conversation.
// ---------------------------------------------------------------------------

const clienteUpdate = z
  .object({
    fullname: z.string().optional(),
    identification_type: z.string().optional(),
    identification: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })
  .optional();

export const extractionSchema = z.object({
  /** What the latest user message is doing. */
  intent: z.enum(INTENTS),
  /** Slot values present/updated in THIS message. Omit fields not mentioned. */
  updates: z.object({
    ciudad: z.string().optional(),
    sede: z.string().optional(),
    fecha_recogida: z.string().optional(),
    fecha_devolucion: z.string().optional(),
    hora_recogida: z.string().optional(),
    hora_devolucion: z.string().optional(),
    gama_elegida: z.string().optional(),
    cliente: clienteUpdate,
  }),
});
export type Extraction = z.infer<typeof extractionSchema>;

/** Drop undefined keys so an absent extraction field never clobbers a known slot. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k as keyof T] = v as T[keyof T];
  }
  return out;
}

/**
 * Merge an extraction into the state's slots (pure). Does NOT change `phase` or
 * `flags` — phase transitions are the orchestrator's job (Etapa 2). Absent fields
 * are ignored so we never overwrite a known value with nothing.
 */
export function applyExtraction(
  state: ConversationState,
  ext: Extraction,
): ConversationState {
  const u = ext.updates ?? {};
  const { cliente, ...rest } = u;
  return {
    ...state,
    slots: {
      ...state.slots,
      ...defined(rest),
      cliente: { ...state.slots.cliente, ...(cliente ? defined(cliente) : {}) },
    },
  };
}
