/**
 * Deterministic booking-DATE parser (P0d hardening). No LLM, no network — pure and
 * fully unit-testable. The third and last structured input moved off the model, after
 * `parseHoras` (hours) and `resolveGamaCode` (gama).
 *
 * DELIBERATELY CONSERVATIVE — a wrong date books the wrong day, so it only rescues
 * UNAMBIGUOUS forms and leaves everything else to the LLM (which handles dates well):
 *  - absolute with a NAMED month: "2 de julio", "julio 2", "2 jul", "el 2 de julio"
 *  - ranges: "del 2 al 5 de julio", "del 2 de julio al 5 de agosto"
 *  - simple relatives: "hoy", "mañana", "pasado mañana"
 * A BARE number ("el 2", "5"), an ambiguous numeric date ("2/7"), and complex relatives
 * ("este fin de semana", "el próximo sábado") are NEVER parsed — they stay with the model.
 *
 * Implicit year = the nearest FUTURE occurrence relative to `todayYMD` (if the month/day
 * already passed this year → next year). Output is "YYYY-MM-DD", in order of appearance.
 */

const MES: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};
const MES_ALT = Object.keys(MES).join("|");

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Build "YYYY-MM-DD" for (month,day) at the nearest future year ≥ today; null if invalid. */
function ymdFuture(month: number, day: number, todayYMD: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  const [ty, tm, td] = todayYMD.split("-").map(Number);
  let year = ty;
  // If the month/day already passed this year, roll to next year.
  if (month < tm || (month === tm && day < td)) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" for a day offset from today (0=hoy, 1=mañana, 2=pasado mañana). */
function ymdOffset(todayYMD: string, offset: number): string {
  const [y, m, d] = todayYMD.split("-").map(Number);
  // Date in UTC to avoid TZ drift; the YMD math is calendar-only.
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Unambiguous booking dates in the message, in order, as "YYYY-MM-DD". [] when none.
 * "del 2 al 5 de julio" → ["2026-07-02","2026-07-05"]; "mañana" → [today+1].
 */
export function parseFechas(message: string, todayYMD: string): string[] {
  let work = message.toLowerCase();
  const found: Array<{ pos: number; ymd: string }> = [];
  const push = (pos: number, ymd: string | null) => {
    if (ymd) found.push({ pos, ymd });
  };
  // Replace a consumed span with spaces so later passes don't re-read it (keeps positions).
  const blank = (m: string) => " ".repeat(m.length);

  // 1. Relatives (most specific first: "pasado mañana" before "mañana").
  for (const m of work.matchAll(/pasado\s+ma[nñ]ana/g)) push(m.index ?? 0, ymdOffset(todayYMD, 2));
  work = work.replace(/pasado\s+ma[nñ]ana/g, blank);
  for (const m of work.matchAll(/\bma[nñ]ana\b/g)) push(m.index ?? 0, ymdOffset(todayYMD, 1));
  work = work.replace(/\bma[nñ]ana\b/g, blank);
  for (const m of work.matchAll(/\bhoy\b/g)) push(m.index ?? 0, ymdOffset(todayYMD, 0));
  work = work.replace(/\bhoy\b/g, blank);

  // 2. Range across DIFFERENT months: "del 2 de julio al 5 de agosto".
  const rangeDiff = new RegExp(
    `\\b(?:del?\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MES_ALT})\\s+al\\s+(\\d{1,2})\\s+(?:de\\s+)?(${MES_ALT})\\b`,
    "g",
  );
  work = work.replace(rangeDiff, (mm, d1, mes1, d2, mes2, off: number) => {
    push(off, ymdFuture(MES[mes1], Number(d1), todayYMD));
    push(off + 1, ymdFuture(MES[mes2], Number(d2), todayYMD));
    return blank(mm);
  });

  // 3. Range SAME month: "del 2 al 5 de julio" (day1 inherits the month of day2).
  const rangeSame = new RegExp(
    `\\b(?:del?\\s+)?(\\d{1,2})\\s+al\\s+(\\d{1,2})\\s+(?:de\\s+)?(${MES_ALT})\\b`,
    "g",
  );
  work = work.replace(rangeSame, (mm, d1, d2, mes, off: number) => {
    push(off, ymdFuture(MES[mes], Number(d1), todayYMD));
    push(off + 1, ymdFuture(MES[mes], Number(d2), todayYMD));
    return blank(mm);
  });

  // 4. Standalone absolute: "2 de julio" / "2 julio".
  const dayMonth = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${MES_ALT})\\b`, "g");
  work = work.replace(dayMonth, (mm, d, mes, off: number) => {
    push(off, ymdFuture(MES[mes], Number(d), todayYMD));
    return blank(mm);
  });

  // 5. Standalone absolute reversed: "julio 2".
  const monthDay = new RegExp(`\\b(${MES_ALT})\\s+(\\d{1,2})\\b`, "g");
  work.replace(monthDay, (mm, mes, d, off: number) => {
    push(off, ymdFuture(MES[mes], Number(d), todayYMD));
    return mm;
  });

  return found.sort((a, b) => a.pos - b.pos).map((x) => x.ymd);
}
