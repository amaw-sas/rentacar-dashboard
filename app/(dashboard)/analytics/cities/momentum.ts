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
