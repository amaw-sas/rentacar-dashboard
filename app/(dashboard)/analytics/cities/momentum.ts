import type { CityDailyPoint } from "@/lib/queries/analytics";
import type { CityMetric } from "./pivot";

// Per-city trend for the detail table's sparkline column.
//
// The arrow compares 3 FULL days vs the prior 3, EXCLUDING today (partial), over
// a 7-day window (today-6 .. today). The sparkline itself plots only the last
// PLOT_DAYS of that window — INCLUDING today — so the latest movement is visible
// while the arrow stays unbiased by the partial day.
const TREND_DAYS = 7;
const PLOT_DAYS = 5;

export interface CitySparkline {
  values: number[]; // last PLOT_DAYS daily counts, oldest → newest, includes today
  trend: "up" | "down" | "flat";
}

// "YYYY-MM-DD" minus n days, computed in UTC so it never shifts across a DST/
// local-offset boundary (the input is already a Bogota civil date).
function ymdMinus(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// On the 7-slot window, slots [3,4,5] are the recent full days and [0,1,2] the
// prior ones; slot 6 (today) is ignored so a partial day never tips the arrow.
function trendOf(window7: number[]): "up" | "down" | "flat" {
  const recent = window7[3] + window7[4] + window7[5];
  const prior = window7[0] + window7[1] + window7[2];
  if (recent > prior) return "up";
  if (recent < prior) return "down";
  return "flat";
}

// Per-city sparkline data keyed by city id ("__none__" for the null-city
// bucket), from the existing cities_daily_series. Builds the full 7-day window
// (for an unbiased trend) but exposes only the last PLOT_DAYS values to plot.
// Missing days are 0 so every sparkline shares the same x-axis. Follows the
// Creadas/Utilizadas metric.
export function cityDailyValues(
  series: CityDailyPoint[],
  todayYMD: string,
  metric: CityMetric
): Map<string, CitySparkline> {
  const field = metric === "used" ? "used_count" : "created_count";
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < TREND_DAYS; i++) {
    dayIndex.set(ymdMinus(todayYMD, TREND_DAYS - 1 - i), i);
  }

  const byCity = new Map<string, number[]>();
  for (const p of series) {
    const idx = dayIndex.get(p.day);
    if (idx === undefined) continue;
    const key = p.city_id ?? "__none__";
    let arr = byCity.get(key);
    if (!arr) {
      arr = new Array(TREND_DAYS).fill(0);
      byCity.set(key, arr);
    }
    arr[idx] += Number(p[field] ?? 0);
  }

  const out = new Map<string, CitySparkline>();
  for (const [key, window7] of byCity) {
    out.set(key, {
      values: window7.slice(TREND_DAYS - PLOT_DAYS), // last PLOT_DAYS, incl today
      trend: trendOf(window7),
    });
  }
  return out;
}
