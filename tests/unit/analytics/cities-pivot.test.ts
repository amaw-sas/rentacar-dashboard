import { describe, it, expect } from "vitest";
import {
  rankCities,
  countKey,
  NO_CITY_LABEL,
} from "@/app/(dashboard)/analytics/cities/pivot";
import type { CityPeriodCounts } from "@/lib/queries/analytics";

const CODES = ["atc", "am", "ac"];

function row(
  over: Partial<CityPeriodCounts> & { franchise: string }
): CityPeriodCounts {
  return {
    city_id: null,
    city_name: null,
    created_today: 0,
    created_yesterday: 0,
    created_week: 0,
    created_last7: 0,
    created_last14: 0,
    created_last30: 0,
    created_month: 0,
    used_today: 0,
    used_yesterday: 0,
    used_week: 0,
    used_last7: 0,
    used_last14: 0,
    used_last30: 0,
    used_month: 0,
    ...over,
  };
}

describe("countKey", () => {
  it("maps metric + period to the RPC column", () => {
    expect(countKey("used", "month")).toBe("used_month");
    expect(countKey("created", "today")).toBe("created_today");
    expect(countKey("used", "last7")).toBe("used_last7");
    expect(countKey("created", "last30")).toBe("created_last30");
  });
});

describe("rankCities", () => {
  const data: CityPeriodCounts[] = [
    row({ city_id: "b", city_name: "Bogotá", franchise: "atc", used_month: 12 }),
    row({ city_id: "b", city_name: "Bogotá", franchise: "am", used_month: 8 }),
    row({ city_id: "b", city_name: "Bogotá", franchise: "ac", used_month: 5 }),
    row({ city_id: "m", city_name: "Medellín", franchise: "atc", used_month: 6 }),
    row({ city_id: "m", city_name: "Medellín", franchise: "am", used_month: 9 }),
    row({ city_id: "m", city_name: "Medellín", franchise: "ac", used_month: 2 }),
    // Zero for the selected slice → must be dropped.
    row({ city_id: "z", city_name: "Cero", franchise: "atc", used_month: 0 }),
    // No city + a created-only count (should not appear under used_month).
    row({ city_id: null, city_name: null, franchise: "atc", created_month: 4 }),
  ];

  it("sums franchises per city, sorts by total desc, keeps zero-total cities last", () => {
    const { rows } = rankCities(data, CODES, "used", "month");
    // Active cities first (by total), then zero-total cities alphabetically.
    expect(rows.map((r) => r.cityName)).toEqual([
      "Bogotá",
      "Medellín",
      "Cero",
      "Sin ciudad",
    ]);
    expect(rows[0].total).toBe(25);
    expect(rows[0].byFranchise).toEqual({ atc: 12, am: 8, ac: 5 });
    expect(rows[1].total).toBe(17);
    expect(rows[2].total).toBe(0);
    expect(rows[3].total).toBe(0);
  });

  it("reconciles column totals and grand total with the rows", () => {
    const { franchiseTotals, grandTotal, rows } = rankCities(
      data,
      CODES,
      "used",
      "month"
    );
    expect(franchiseTotals).toEqual({ atc: 18, am: 17, ac: 7 });
    expect(grandTotal).toBe(42);
    expect(grandTotal).toBe(rows.reduce((a, r) => a + r.total, 0));
    expect(grandTotal).toBe(
      Object.values(franchiseTotals).reduce((a, n) => a + n, 0)
    );
  });

  it("labels the null-city bucket and isolates the metric", () => {
    // created_month: only the null-city row has a non-zero count; it leads, the
    // others follow at 0.
    const { rows, grandTotal } = rankCities(data, CODES, "created", "month");
    expect(rows[0].cityName).toBe(NO_CITY_LABEL);
    expect(rows[0].total).toBe(4);
    expect(grandTotal).toBe(4);
  });

  it("keeps every city (at 0) when the slice has no rentals", () => {
    const { rows, grandTotal } = rankCities(data, CODES, "used", "today");
    // All cities still listed, just summing to 0 — the complete listing.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.total === 0)).toBe(true);
    expect(grandTotal).toBe(0);
  });

  it("breaks ties by city name", () => {
    const tied: CityPeriodCounts[] = [
      row({ city_id: "1", city_name: "Pereira", franchise: "atc", used_today: 3 }),
      row({ city_id: "2", city_name: "Armenia", franchise: "atc", used_today: 3 }),
    ];
    const { rows } = rankCities(tied, CODES, "used", "today");
    expect(rows.map((r) => r.cityName)).toEqual(["Armenia", "Pereira"]);
  });

  it("selects the rolling-window columns independently", () => {
    const rolling: CityPeriodCounts[] = [
      row({
        city_id: "c",
        city_name: "Cali",
        franchise: "atc",
        used_last7: 4,
        used_last14: 9,
        used_last30: 20,
      }),
    ];
    expect(rankCities(rolling, CODES, "used", "last7").grandTotal).toBe(4);
    expect(rankCities(rolling, CODES, "used", "last14").grandTotal).toBe(9);
    expect(rankCities(rolling, CODES, "used", "last30").grandTotal).toBe(20);
  });
});
