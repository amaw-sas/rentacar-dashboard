// Date-boundary helpers anchored to Colombia time (America/Bogota).
//
// Colombia uses a fixed UTC-5 offset year-round (no DST), so we derive the
// local calendar date with Intl and then construct the instant by appending
// the literal "-05:00" offset — no date-fns-tz dependency required. Every
// helper returns an ISO string in UTC, ready to compare against `created_at`
// (a `timestamptz` stored in UTC) via `.gte("created_at", ...)`.

const BOGOTA_OFFSET = "-05:00";

// "YYYY-MM-DD" calendar date in Bogota for the given instant.
function bogotaDateParts(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // e.g. "2026-06-09"
}

// Instant (UTC) at 00:00 Colombia of the current day.
export function bogotaStartOfDayISO(now: Date = new Date()): string {
  const ymd = bogotaDateParts(now);
  return new Date(`${ymd}T00:00:00${BOGOTA_OFFSET}`).toISOString();
}

// Instant (UTC) at 00:00 Colombia on Monday of the current week.
export function bogotaStartOfWeekISO(now: Date = new Date()): string {
  const ymd = bogotaDateParts(now);
  // `ymd` is already the Bogota civil date, so getUTCDay() of that date at
  // 00:00 UTC is its weekday; step back to Monday. setUTCDate handles
  // month/year rollover.
  const d = new Date(`${ymd}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // 0=Sun..6=Sat → Mon-based
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  const monday = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return new Date(`${monday}T00:00:00${BOGOTA_OFFSET}`).toISOString();
}

// Instant (UTC) at 00:00 Colombia on the first day of the current month.
export function bogotaStartOfMonthISO(now: Date = new Date()): string {
  const ym = bogotaDateParts(now).slice(0, 7); // "YYYY-MM"
  return new Date(`${ym}-01T00:00:00${BOGOTA_OFFSET}`).toISOString();
}
