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

// Instant (UTC) at 00:00 Colombia of the given civil date "YYYY-MM-DD".
// Use as the inclusive lower bound of a created_at range filter (issue #115):
// `.gte("created_at", bogotaDayStartISO(from))`.
export function bogotaDayStartISO(ymd: string): string {
  return new Date(`${ymd}T00:00:00.000${BOGOTA_OFFSET}`).toISOString();
}

// Instant (UTC) at the last millisecond of the given civil date in Colombia.
// Use as the inclusive upper bound of a created_at range filter (issue #115):
// `.lte("created_at", bogotaDayEndISO(to))`.
export function bogotaDayEndISO(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999${BOGOTA_OFFSET}`).toISOString();
}

// "YYYY-MM-DD" Bogota civil date of the current day. Use for URL date params and
// `date`-column filters (e.g. pickup_date), where a bare civil date is wanted.
export function bogotaTodayYMD(now: Date = new Date()): string {
  return bogotaDateParts(now);
}

// "YYYY-MM-DD" Bogota civil date of the previous day. Steps the civil date back
// one day at UTC midnight (setUTCDate handles month/year rollover), so it is
// independent of the wall-clock instant.
export function bogotaYesterdayYMD(now: Date = new Date()): string {
  const d = new Date(`${bogotaDateParts(now)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD" of Monday of the current Bogota week. `ymd` is already the Bogota
// civil date, so getUTCDay() of that date at 00:00 UTC is its weekday; step back
// to Monday. setUTCDate handles month/year rollover.
export function bogotaStartOfWeekYMD(now: Date = new Date()): string {
  const d = new Date(`${bogotaDateParts(now)}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // 0=Sun..6=Sat → Mon-based
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

// "YYYY-MM-DD" of the first day of the current Bogota month.
export function bogotaStartOfMonthYMD(now: Date = new Date()): string {
  return `${bogotaDateParts(now).slice(0, 7)}-01`;
}

// "YYYY-MM-DD" of the last day of the current Bogota month. Built as the day
// before the first of next month, so it lands on 28/29/30/31 correctly.
export function bogotaEndOfMonthYMD(now: Date = new Date()): string {
  const d = new Date(`${bogotaDateParts(now).slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0); // rolls back to the last day of the original month
  return d.toISOString().slice(0, 10);
}

// Instant (UTC) at 00:00 Colombia of the current day.
export function bogotaStartOfDayISO(now: Date = new Date()): string {
  return bogotaDayStartISO(bogotaTodayYMD(now));
}

// Instant (UTC) at 00:00 Colombia on Monday of the current week.
export function bogotaStartOfWeekISO(now: Date = new Date()): string {
  return bogotaDayStartISO(bogotaStartOfWeekYMD(now));
}

// Instant (UTC) at 00:00 Colombia on the first day of the current month.
export function bogotaStartOfMonthISO(now: Date = new Date()): string {
  return bogotaDayStartISO(bogotaStartOfMonthYMD(now));
}

// Period presets for the dashboard trend charts.
export type DashboardPeriod = "week" | "month" | "custom";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolves a dashboard trend-chart period to inclusive civil "YYYY-MM-DD"
// Bogota dates, ready to pass to reservation_daily_series(p_from, p_to).
//   week  -> Monday of this week .. today
//   month -> first of this month .. today   (today, not month-end, so the chart
//            never trails future days at 0)
//   custom-> the URL params, swapped to from <= to; falls back to "week" when a
//            param is missing or malformed.
export function resolveDashboardRange(
  period: DashboardPeriod,
  fromParam?: string,
  toParam?: string,
  now: Date = new Date()
): { fromYMD: string; toYMD: string } {
  const today = bogotaTodayYMD(now);

  if (period === "custom") {
    if (fromParam && toParam && YMD_RE.test(fromParam) && YMD_RE.test(toParam)) {
      return fromParam <= toParam
        ? { fromYMD: fromParam, toYMD: toParam }
        : { fromYMD: toParam, toYMD: fromParam };
    }
    return { fromYMD: bogotaStartOfWeekYMD(now), toYMD: today };
  }

  if (period === "month") {
    return { fromYMD: bogotaStartOfMonthYMD(now), toYMD: today };
  }

  return { fromYMD: bogotaStartOfWeekYMD(now), toYMD: today };
}
