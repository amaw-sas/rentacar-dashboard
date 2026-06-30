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
  /** Transmission preference the customer stated: "mecanico" | "automatico". Persisted so
   * the bot never re-asks it (it has no deterministic slot question — it leaked via free-form). */
  transmision?: string;
  /** Vehicle-class preference: "auto" | "camioneta". So the recommended/committed gama matches
   * a "camioneta/SUV/para 7" request instead of defaulting to the cheapest económico car. */
  tipo_vehiculo?: string;
  /** How many vehicles the customer asked for. The chat books ONE per reservation;
   * >1 only triggers a one-time clarification (multi_vehicle_notice_shown). */
  cantidad?: number;
  cliente: ClienteSlots;
}

export interface ConversationFlags {
  greeted: boolean;
  requisitos_shown: boolean;
  quote_shown: boolean;
  /** Hash of (ciudad,sede,fechas,horas) of the last quote shown — detects when a re-cotizar is needed. */
  last_quote_signature?: string;
  /** Hash of the last quote ATTEMPT — set on success AND failure. Stops the bot from
   * re-firing the same failing quote every turn (the "stuck error" loop); a failed quote
   * with unchanged params is no longer stale, so the next message reaches the free-form. */
  last_attempt_signature?: string;
  /** Hash of (ciudad,fechas,horas) WITHOUT sede — detects a sede-only change so the
   * quote can refresh silently instead of re-pasting the whole table (the repetition bug). */
  last_quote_core_signature?: string;
  /** Booking summary emitted once (Etapa 3) — guards re-emitting it in `confirming`. */
  summary_shown?: boolean;
  /** The "I book one vehicle per reservation" notice emitted once — guards repeating it. */
  multi_vehicle_notice_shown?: boolean;
  /** The "we don't offer diésel/van/estacas…" notice emitted once (P0c) — guards repeating it. */
  unsupported_vehicle_notice_shown?: boolean;
  /** The proactive self-serve link (web + share) emitted once on a deferral objection (P3). */
  selfserve_link_shown?: boolean;
  /** The "need another vehicle?" offer emitted after a booking (R3 multi-booking) — lets a bare
   * "sí" re-open the funnel for an additional reservation. */
  another_offer_shown?: boolean;
  /** The quote slot we asked for last turn ("ciudad"/"fecha_recogida"/"fecha_devolucion").
   * Lets the funnel VARY a repeated question instead of asking it verbatim again. */
  last_slot_asked?: string;
  /** How many CONSECUTIVE turns we've asked for `last_slot_asked` without getting it. Drives
   * escalating phrasing (1 normal → 2 with example → 3+ explicit format + advisor offer) so the
   * same question is NEVER emitted verbatim twice (the dominant repeated_question_verbatim bug). */
  last_slot_ask_count?: number;
  /** How many times the "¿Con cuál gama te quedas?" nudge was appended — capped so the bot
   * stops nagging after a couple of off-funnel answers. */
  gama_nudge_count?: number;
  /** The customer field asked last turn ("fullname"/"document"/"email"/"phone") and how many
   * CONSECUTIVE times — so the data question also escalates instead of repeating verbatim. */
  last_customer_field_asked?: string;
  last_customer_field_ask_count?: number;
}

/** A reservation completed THIS conversation (R3 multi-booking) — feeds the same-responsible /
 * overlapping-dates rule when the customer starts an additional reservation. */
export interface Booking {
  identification: string;
  fecha_recogida: string;
  fecha_devolucion: string;
}

export interface ConversationState {
  phase: Phase;
  slots: Slots;
  flags: ConversationFlags;
  /** Reservations already made in this conversation (R3). Server-side only. */
  bookings?: Booking[];
  /** Last quote table shown (incl. the opaque quote blobs) — the booking phase
   * (Etapa 3) resolves the chosen gama's quote from here. Server-side only. */
  lastQuote?: QuoteTable;
  /** Model names per quoted gama code (e.g. {C:["Picanto","Spark"], F:["Sandero"]}), cached
   * at quote time. Feeds the Controller so it can resolve a model name ("el Picanto") to a
   * quoted gama. Server-side only; absent when the Controller is off or the lookup failed. */
  modelsByGama?: Record<string, string[]>;
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

/** The slot-update object: every field nullable (OpenAI strict). Shared by the extractor
 * AND the Controller so both read the same slot vocabulary without drift. */
export const extractionUpdates = z.object({
  ciudad: z.string().nullable(),
  sede: z.string().nullable(),
  fecha_recogida: z.string().nullable(),
  fecha_devolucion: z.string().nullable(),
  hora_recogida: z.string().nullable(),
  hora_devolucion: z.string().nullable(),
  gama_elegida: z.string().nullable(),
  transmision: z.string().nullable(),
  tipo_vehiculo: z.string().nullable(),
  cantidad: z.number().nullable(),
  cliente: clienteUpdate,
});

export const extractionSchema = z.object({
  /** What the latest user message is doing. */
  intent: z.enum(INTENTS),
  /** Slot values present/updated in THIS message. Use null for fields not mentioned. */
  updates: extractionUpdates,
});
export type Extraction = z.infer<typeof extractionSchema>;

/**
 * Loose update shape the merge accepts: any subset of slot fields (each value or
 * null). A full {@link Extraction} satisfies it, and so do the partial literals used
 * in tests — the merge only ever reads the keys that are present.
 */
export type SlotUpdates = {
  [K in keyof Omit<Slots, "cliente">]?: Slots[K] | null;
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
