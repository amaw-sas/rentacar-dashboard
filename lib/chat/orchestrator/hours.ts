/**
 * Deterministic booking-hour parser (P0d hardening). No LLM, no network — pure and
 * fully unit-testable.
 *
 * The slot extractor is an LLM and INTERMITTENTLY fails to convert "9am" → "09:00",
 * which jams the hours gate: `hasBookingHours` stays false and the bot re-asks forever
 * (the "no parsea 9am" bug). This rescues the hours straight from the customer's text
 * so the funnel never depends on the model's mood for something this structured.
 *
 * CONSERVATIVE on purpose: a time is only recognized with a clear marker (am/pm,
 * ":mm", a trailing "h", "de la mañana/tarde/noche", or "mediodía/medianoche"). A
 * bare number is NEVER read as a time, so dates ("del 5 al 9 de julio"), seat counts
 * ("9 puestos") and id numbers never turn into hours.
 */

const WORD_NUM: Record<string, number> = {
  cero: 0,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

/** Build "HH:mm" from (hour, minute, meridiem), applying 12h→24h; null if out of range. */
function fmt(h: number, m: number, mer: "am" | "pm" | null): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59) return null;
  if (mer === "am") {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
  } else if (mer === "pm") {
    if (h < 1 || h > 12) return null;
    if (h !== 12) h += 12;
  } else if (h < 0 || h > 23) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * All clearly-marked times in the message, in order of appearance, normalized to
 * "HH:mm" (24h). Returns [] when none. "9am y lo regreso 9am" → ["09:00", "09:00"].
 */
export function parseHoras(message: string): string[] {
  const text = message.toLowerCase();
  const found: Array<{ pos: number; hhmm: string }> = [];

  // mediodía → 12:00, medianoche → 00:00
  for (const m of text.matchAll(/mediod[ií]a|medianoche/g)) {
    found.push({ pos: m.index ?? 0, hhmm: m[0].startsWith("mediod") ? "12:00" : "00:00" });
  }

  // word number + franja: "nueve de la mañana/tarde/noche"
  const wordRe = new RegExp(
    `\\b(${Object.keys(WORD_NUM).join("|")})\\s+de\\s+la\\s+(ma[nñ]ana|tarde|noche)`,
    "g",
  );
  for (const m of text.matchAll(wordRe)) {
    const mer = m[2].startsWith("ma") ? "am" : "pm";
    const v = fmt(WORD_NUM[m[1]], 0, mer);
    if (v) found.push({ pos: m.index ?? 0, hhmm: v });
  }

  // numeric with a marker: 9am | 9 am | 9 a.m. | 9:30pm | 9:00 | 21:30 | 21h | 9 de la tarde
  const numRe =
    /(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|h(?:rs?)?\b|de\s+la\s+(ma[nñ]ana|tarde|noche))?/g;
  for (const m of text.matchAll(numRe)) {
    const tag = m[3] ?? "";
    const hasMinutes = m[2] !== undefined;
    let mer: "am" | "pm" | null = null;
    let marked = false;
    if (/^a/.test(tag)) {
      mer = "am";
      marked = true;
    } else if (/^p/.test(tag)) {
      mer = "pm";
      marked = true;
    } else if (/^h/.test(tag)) {
      marked = true; // "21h"
    } else if (/^de\s+la/.test(tag)) {
      mer = m[4] === "tarde" || m[4] === "noche" ? "pm" : "am";
      marked = true;
    } else if (hasMinutes) {
      marked = true; // "9:00" / "21:30"
    }
    if (!marked) continue; // a BARE number is never a time
    const v = fmt(Number(m[1]), hasMinutes ? Number(m[2]) : 0, mer);
    if (v) found.push({ pos: m.index ?? 0, hhmm: v });
  }

  return found.sort((a, b) => a.pos - b.pos).map((x) => x.hhmm);
}
