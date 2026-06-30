import type { LocationDirectoryItem } from "@/lib/api/location-directory";
import { norm, resolveLocationCode } from "@/lib/api/mcp/tools";
import { parseHoras } from "./hours";
import type { Slots } from "./slots";

/**
 * Deterministic slot grounding (P0 · CHAT_SLOT_GROUNDING).
 *
 * A PURE step between the LLM extraction (`applyExtraction`) and the FSM. The FSM
 * acts on the slots the model extracts each turn; when that extraction is wrong the
 * funnel either jams (a stuck/invalid `ciudad`, never reaching `canQuote`) or does
 * something absurd (quoting an económico to someone who asked for diésel). This layer
 * validates/corrects the slots against the REAL catalog (the location directory) so
 * the FSM never has to trust a bad extraction.
 *
 * It depends on NO LLM and NO network (the directory is passed in), so it is fully
 * unit-testable — unlike the model's own resolution, which only the live self-play
 * eval can measure. Everything is gated by CHAT_SLOT_GROUNDING at the call site; this
 * module is pure and side-effect free.
 */

/** A correction/observation the grounding made — the FSM maps each to a fixed block. */
export type GroundingNote =
  | {
      /** `ciudad` is not a city we serve; it was dropped from the slots. */
      kind: "city_not_serviceable";
      attempted: string;
      /** Display names of the cities we DO serve (for the deterministic offer). */
      valid: string[];
    }
  | {
      /** `ciudad` was derived/corrected from the named sede. */
      kind: "city_derived_from_sede";
      sede: string;
      city: string;
    }
  | {
      /** The customer asked for a vehicle class/fuel we don't offer. */
      kind: "unsupported_vehicle";
      term: string;
    };

export interface GroundingInput {
  slots: Slots;
  /** The raw customer message this turn — the unsupported-vehicle detector reads it. */
  userMessage: string;
  directory: LocationDirectoryItem[];
}

export interface GroundingResult {
  slots: Slots;
  notes: GroundingNote[];
}

/** Distinct city slugs we serve, sorted. */
function servedCitySlugs(directory: LocationDirectoryItem[]): string[] {
  return [...new Set(directory.map((l) => l.city))].sort();
}

/** "santa-marta" → "Santa Marta" (the directory stores `city` as a slug). */
function prettyCity(slug: string): string {
  return slug
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Does the directory serve this city name? Reuses the same matcher the tools use. */
function cityIsServiceable(
  directory: LocationDirectoryItem[],
  ciudad: string,
): boolean {
  return resolveLocationCode(directory, ciudad) !== null;
}

/**
 * The single city a named sede belongs to, or null when the sede matches no branch
 * or is ambiguous across cities (e.g. a bare "aeropuerto" present in several cities —
 * we must NOT guess one). Matches the sede against the branch `name`/`slug`.
 */
function cityFromSede(
  directory: LocationDirectoryItem[],
  sede: string,
): string | null {
  const s = norm(sede);
  if (!s) return null;
  const matches = directory.filter(
    (l) => norm(l.name).includes(s) || norm(l.slug).includes(s),
  );
  const cities = [...new Set(matches.map((l) => l.city))];
  return cities.length === 1 ? cities[0] : null;
}

/**
 * Vehicle classes/fuels we do NOT offer. We rent gasolina cars and camionetas/SUVs;
 * the funnel must SAY SO before quoting an económico to someone who asked for diésel,
 * a van, estacas, etc. — instead of silently cotizando the wrong product.
 *
 * NOTE: "híbrido" is intentionally NOT here — the FL/LU hybrid gamas DO exist in the
 * real catalog (KB correction). Only clearly-unsupported terms are flagged.
 */
const UNSUPPORTED_VEHICLE: Array<{ re: RegExp; term: string }> = [
  { re: /di[eé]sel/i, term: "diésel" },
  { re: /\bel[eé]ctric[oa]s?\b|\bev\b/i, term: "eléctrico" },
  { re: /\bvan\b|furg[oó]n|microb[uú]s|buseta/i, term: "van/furgón" },
  { re: /estacas?|plat[oó]n/i, term: "vehículo de estacas/platón" },
  { re: /blindad[oa]s?/i, term: "blindado" },
  { re: /cami[oó]n(?:es|eta)?\b/i, term: "camión" },
  { re: /\bmotos?\b/i, term: "moto" },
];

/** First unsupported vehicle term the message asks for, or null. */
export function detectUnsupportedVehicle(message: string): string | null {
  // A "camioneta" is supported (SUV/pickup); only treat "camión" as unsupported. The
  // camión regex excludes "camioneta" via the alternation, but guard explicitly too.
  for (const { re, term } of UNSUPPORTED_VEHICLE) {
    if (term === "camión" && /cami[oó]neta/i.test(message)) continue;
    if (re.test(message)) return term;
  }
  return null;
}

/**
 * Validate and correct the extracted slots against the catalog. Pure: returns new
 * slots + the notes the FSM uses to emit deterministic blocks. Order matters — a
 * sede-derived city is reconciled FIRST, then the (possibly corrected) city is
 * validated for serviceability.
 */
export function groundSlots(input: GroundingInput): GroundingResult {
  const { directory, userMessage } = input;
  const slots: Slots = { ...input.slots };
  const notes: GroundingNote[] = [];

  // (b) Reconcile ciudad ← sede. A named sede is a stronger signal than a possibly
  // stale/wrong ciudad: if the sede unambiguously belongs to one city and that city
  // differs from the current ciudad, derive it. Kills the "Tuluá stuck after picking
  // a Palmira branch" class in code, not just in the prompt.
  if (slots.sede) {
    const derived = cityFromSede(directory, slots.sede);
    if (derived && (!slots.ciudad || norm(slots.ciudad) !== norm(derived))) {
      slots.ciudad = derived;
      notes.push({
        kind: "city_derived_from_sede",
        sede: slots.sede,
        city: prettyCity(derived),
      });
    }
  }

  // (a) Serviceable city. An unserved ciudad (e.g. Tuluá) must NOT persist — otherwise
  // it jams every later turn and the quote fails with a cryptic provider error. Drop it
  // and let the FSM offer the served cities deterministically.
  if (slots.ciudad && !cityIsServiceable(directory, slots.ciudad)) {
    notes.push({
      kind: "city_not_serviceable",
      attempted: slots.ciudad,
      valid: servedCitySlugs(directory).map(prettyCity),
    });
    slots.ciudad = undefined;
  }

  // (c) Unsupported vehicle. Flag a diésel/van/estacas/etc. request so the FSM warns
  // BEFORE cotizando an económico that ignores what they asked for.
  const term = detectUnsupportedVehicle(userMessage);
  if (term) notes.push({ kind: "unsupported_vehicle", term });

  // (d) Hours rescue. The LLM extractor intermittently drops "9am", jamming the hours
  // gate (it re-asks forever). Parse the booking hours deterministically from the
  // message and fill ONLY the blanks, consuming them in order for the missing slots
  // ("9am y lo regreso 9am" → recogida 09:00, devolución 09:00). Never overwrites a
  // good extraction; a bare number is never read as a time (see parseHoras).
  if (!slots.hora_recogida || !slots.hora_devolucion) {
    const horas = parseHoras(userMessage);
    let i = 0;
    if (!slots.hora_recogida && i < horas.length) slots.hora_recogida = horas[i++];
    if (!slots.hora_devolucion && i < horas.length) slots.hora_devolucion = horas[i++];
  }

  return { slots, notes };
}

/** Both booking hours present — the gate before moving to customer data (P0d). */
export function hasBookingHours(slots: Slots): boolean {
  return Boolean(slots.hora_recogida && slots.hora_devolucion);
}
