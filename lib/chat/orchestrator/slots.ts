import { z } from "zod";
import type { QuoteTable } from "./quote-service";

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
  /** Last quote table shown (incl. the opaque quote blobs) — the booking phase
   * (Etapa 3) resolves the chosen gama's quote from here. Server-side only. */
  lastQuote?: QuoteTable;
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

// NOTE: every field is `.nullable()` (required key, value-or-null) rather than
// `.optional()`. OpenAI strict structured outputs (the default for generateObject
// with an openai model) rejects schemas whose objects don't list EVERY property in
// `required` — `.optional()` makes the call throw at runtime (`Invalid schema for
// response_format … 'required' … Missing 'fullname'`), silently killing extraction.
// The model returns null for fields the user didn't mention; `defined()` filters
// those out on merge, so an absent value never clobbers a known slot.
const clienteUpdate = z
  .object({
    fullname: z.string().nullable(),
    identification_type: z.string().nullable(),
    identification: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  })
  .nullable();

export const extractionSchema = z.object({
  /** What the latest user message is doing. */
  intent: z.enum(INTENTS),
  /** Slot values present/updated in THIS message. Use null for fields not mentioned. */
  updates: z.object({
    ciudad: z.string().nullable(),
    sede: z.string().nullable(),
    fecha_recogida: z.string().nullable(),
    fecha_devolucion: z.string().nullable(),
    hora_recogida: z.string().nullable(),
    hora_devolucion: z.string().nullable(),
    gama_elegida: z.string().nullable(),
    cliente: clienteUpdate,
  }),
});
export type Extraction = z.infer<typeof extractionSchema>;

/**
 * Loose update shape the merge accepts: any subset of slot fields (each value or
 * null). A full {@link Extraction} satisfies it, and so do the partial literals used
 * in tests — the merge only ever reads the keys that are present.
 */
export type SlotUpdates = {
  [K in keyof Omit<Slots, "cliente">]?: string | null;
} & { cliente?: Partial<Record<keyof ClienteSlots, string | null>> | null };

/** Drop undefined/null/empty keys so an absent extraction field never clobbers a known slot. */
function defined<T extends Record<string, unknown>>(
  obj: T,
): Partial<{ [K in keyof T]: NonNullable<T[K]> }> {
  const out: Partial<{ [K in keyof T]: NonNullable<T[K]> }> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") {
      out[k as keyof T] = v as NonNullable<T[keyof T]>;
    }
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
  ext: { intent: Intent; updates?: SlotUpdates },
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
