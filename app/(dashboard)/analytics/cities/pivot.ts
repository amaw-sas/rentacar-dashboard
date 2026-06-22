import type { CityPeriodCounts } from "@/lib/queries/analytics";

export type CityPeriod = "today" | "yesterday" | "week" | "month";
export type CityMetric = "created" | "used";

export const NO_CITY_LABEL = "Sin ciudad";

export interface CityRankRow {
  cityId: string | null;
  cityName: string; // resolved label (NO_CITY_LABEL for a null city)
  byFranchise: Record<string, number>; // franchise code → count
  total: number;
}

export interface CityRanking {
  rows: CityRankRow[]; // total desc, then city name asc; zero-total cities dropped
  franchiseTotals: Record<string, number>; // column totals over the visible rows
  grandTotal: number;
}

// The RPC returns one column per metric×period; this resolves the active pair.
export function countKey(
  metric: CityMetric,
  period: CityPeriod
): keyof CityPeriodCounts {
  return `${metric}_${period}` as keyof CityPeriodCounts;
}

// Collapses the (city, franchise) RPC rows into one ranked row per city for the
// selected metric+period: sums each franchise's count, drops cities with no
// rentals in this slice, and sorts by total (then name) so the busiest city
// leads. franchiseCodes fixes the column set/order and seeds zeros so every
// city has an entry for every franchise.
export function rankCities(
  data: CityPeriodCounts[],
  franchiseCodes: string[],
  metric: CityMetric,
  period: CityPeriod
): CityRanking {
  const key = countKey(metric, period);
  const byCity = new Map<string, CityRankRow>();

  for (const r of data) {
    if (!franchiseCodes.includes(r.franchise)) continue; // ignore stray codes
    const id = r.city_id ?? "__none__";
    let row = byCity.get(id);
    if (!row) {
      row = {
        cityId: r.city_id,
        cityName: r.city_name ?? NO_CITY_LABEL,
        byFranchise: Object.fromEntries(franchiseCodes.map((c) => [c, 0])),
        total: 0,
      };
      byCity.set(id, row);
    }
    const n = Number(r[key] ?? 0);
    row.byFranchise[r.franchise] += n;
    row.total += n;
  }

  const rows = Array.from(byCity.values())
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.cityName.localeCompare(b.cityName));

  const franchiseTotals: Record<string, number> = Object.fromEntries(
    franchiseCodes.map((c) => [c, 0])
  );
  for (const row of rows) {
    for (const c of franchiseCodes) franchiseTotals[c] += row.byFranchise[c];
  }
  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);

  return { rows, franchiseTotals, grandTotal };
}
