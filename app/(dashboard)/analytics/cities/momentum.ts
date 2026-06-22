import type { CityDailyPoint } from "@/lib/queries/analytics";
import type { CityMetric } from "./pivot";
import { NO_CITY_LABEL } from "./pivot";

export interface MomentumRow {
  cityId: string | null;
  cityName: string;
  recent: number; // sum over the recent 3 full days
  prior: number; // sum over the prior 3 full days
  delta: number; // recent - prior
  isNew: boolean; // prior === 0 && recent > 0 (demand starting up)
}

export interface CityMomentum {
  rising: MomentumRow[]; // delta > 0, biggest gain first
  falling: MomentumRow[]; // delta < 0, biggest drop first
}

// Days plotted in the per-city sparkline (today-6 .. today, oldest → newest).
export const SPARK_DAYS = 7;

export interface CitySparkline {
  values: number[]; // SPARK_DAYS daily counts, oldest → newest
  trend: "up" | "down" | "flat"; // 3 full days vs prior 3, same window as momentum
}

// Window: 3 FULL days vs the 3 before them, EXCLUDING today (partial). For
// today = D the recent window is [D-1, D-2, D-3] and the prior is [D-4, D-5,
// D-6]. Excluding today avoids the partial-day undercount that makes a midday
// reading look like a drop.
const RECENT_OFFSETS = [1, 2, 3];
const PRIOR_OFFSETS = [4, 5, 6];

// "YYYY-MM-DD" minus n days, computed in UTC so it never shifts across a DST/
// local-offset boundary (the input is already a Bogota civil date).
function ymdMinus(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function dayMonth(ymd: string): { d: number; m: number } {
  const [, m, d] = ymd.split("-").map(Number);
  return { d, m };
}

// "16–18 jun" (same month) or "30 may–2 jun" (crossing). Inclusive range.
function formatRange(startYMD: string, endYMD: string): string {
  const a = dayMonth(startYMD);
  const b = dayMonth(endYMD);
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_ES[a.m - 1]}`;
  return `${a.d} ${MONTHS_ES[a.m - 1]}–${b.d} ${MONTHS_ES[b.m - 1]}`;
}

// Human labels for the two comparison windows, so the report can show exactly
// which days "reciente" and "previo" cover.
export function momentumWindowLabels(todayYMD: string): {
  recent: string;
  prior: string;
} {
  return {
    recent: formatRange(ymdMinus(todayYMD, 3), ymdMinus(todayYMD, 1)),
    prior: formatRange(ymdMinus(todayYMD, 6), ymdMinus(todayYMD, 4)),
  };
}

// Aggregates the per-(day, city) series into a recent-vs-prior comparison per
// city and splits cities into rising / falling. todayYMD is the Bogota civil
// date the offsets are measured from; metric picks created vs used.
export function rankCityMomentum(
  series: CityDailyPoint[],
  todayYMD: string,
  metric: CityMetric
): CityMomentum {
  const field = metric === "used" ? "used_count" : "created_count";
  const recentDays = new Set(RECENT_OFFSETS.map((n) => ymdMinus(todayYMD, n)));
  const priorDays = new Set(PRIOR_OFFSETS.map((n) => ymdMinus(todayYMD, n)));

  const byCity = new Map<string, MomentumRow>();
  for (const p of series) {
    const inRecent = recentDays.has(p.day);
    const inPrior = priorDays.has(p.day);
    if (!inRecent && !inPrior) continue;
    const id = p.city_id ?? "__none__";
    let row = byCity.get(id);
    if (!row) {
      row = {
        cityId: p.city_id,
        cityName: p.city_name ?? NO_CITY_LABEL,
        recent: 0,
        prior: 0,
        delta: 0,
        isNew: false,
      };
      byCity.set(id, row);
    }
    const n = Number(p[field] ?? 0);
    if (inRecent) row.recent += n;
    if (inPrior) row.prior += n;
  }

  const rows: MomentumRow[] = [];
  for (const row of byCity.values()) {
    row.delta = row.recent - row.prior;
    row.isNew = row.prior === 0 && row.recent > 0;
    rows.push(row);
  }

  const rising = rows
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta || b.recent - a.recent);
  const falling = rows
    .filter((r) => r.delta < 0)
    .sort((a, b) => a.delta - b.delta || b.prior - a.prior);

  return { rising, falling };
}

// Same recent-3-vs-prior-3 (today excluded) comparison rankCityMomentum uses,
// but read off a fixed 7-slot array: slots [3,4,5] are the recent full days,
// [0,1,2] the prior ones.
function sparklineTrend(values: number[]): "up" | "down" | "flat" {
  const recent = values[3] + values[4] + values[5];
  const prior = values[0] + values[1] + values[2];
  if (recent > prior) return "up";
  if (recent < prior) return "down";
  return "flat";
}

// Per-city daily counts for the sparkline column, keyed by city id ("__none__"
// for the null-city bucket). Each array is SPARK_DAYS long (today-6 .. today,
// oldest → newest) with missing days filled to 0, so every sparkline shares the
// same x-axis. Follows the Creadas/Utilizadas metric.
export function cityDailyValues(
  series: CityDailyPoint[],
  todayYMD: string,
  metric: CityMetric
): Map<string, CitySparkline> {
  const field = metric === "used" ? "used_count" : "created_count";
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < SPARK_DAYS; i++) {
    dayIndex.set(ymdMinus(todayYMD, SPARK_DAYS - 1 - i), i);
  }

  const byCity = new Map<string, number[]>();
  for (const p of series) {
    const idx = dayIndex.get(p.day);
    if (idx === undefined) continue;
    const key = p.city_id ?? "__none__";
    let arr = byCity.get(key);
    if (!arr) {
      arr = new Array(SPARK_DAYS).fill(0);
      byCity.set(key, arr);
    }
    arr[idx] += Number(p[field] ?? 0);
  }

  const out = new Map<string, CitySparkline>();
  for (const [key, values] of byCity) {
    out.set(key, { values, trend: sparklineTrend(values) });
  }
  return out;
}
