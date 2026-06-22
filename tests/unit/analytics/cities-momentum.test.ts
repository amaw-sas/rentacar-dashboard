import { describe, it, expect } from "vitest";
import { cityDailyValues } from "@/app/(dashboard)/analytics/cities/momentum";
import type { CityDailyPoint } from "@/lib/queries/analytics";

const TODAY = "2026-06-22";
// 7-day window = 16..22. Sparkline plots the last 5 (18..22), incl today (22).
// Trend compares recent full days (19,20,21) vs prior (16,17,18), excludes 22.

function pt(
  day: string,
  city_id: string | null,
  city_name: string | null,
  used = 0,
  created = 0
): CityDailyPoint {
  return { day, city_id, city_name, used_count: used, created_count: created };
}

describe("cityDailyValues", () => {
  it("plots the last 5 days (incl today), oldest→newest, filling gaps with 0", () => {
    const series: CityDailyPoint[] = [
      pt("2026-06-16", "m", "Medellín", 9), // day-6: in trend window, NOT plotted
      pt("2026-06-19", "m", "Medellín", 3),
      pt("2026-06-22", "m", "Medellín", 5), // today
    ];
    const spark = cityDailyValues(series, TODAY, "used").get("m")!;
    // plotted days 18,19,20,21,22 → [0, 3, 0, 0, 5]
    expect(spark.values).toEqual([0, 3, 0, 0, 5]);
  });

  it("derives the trend from full days, excluding today", () => {
    // recent (19,20,21) vs prior (16,17,18); today (22) ignored.
    const up: CityDailyPoint[] = [
      pt("2026-06-18", "a", "A", 1),
      pt("2026-06-20", "a", "A", 6),
      pt("2026-06-22", "a", "A", 0), // partial today must not affect the arrow
    ];
    expect(cityDailyValues(up, TODAY, "used").get("a")!.trend).toBe("up");

    const down: CityDailyPoint[] = [
      pt("2026-06-17", "b", "B", 8),
      pt("2026-06-21", "b", "B", 1),
    ];
    expect(cityDailyValues(down, TODAY, "used").get("b")!.trend).toBe("down");
  });

  it("ignores days outside the 7-day trend window", () => {
    const series: CityDailyPoint[] = [pt("2026-06-15", "out", "Out", 9)]; // day-7
    expect(cityDailyValues(series, TODAY, "used").has("out")).toBe(false);
  });

  it("respects the metric (created vs used)", () => {
    const series: CityDailyPoint[] = [pt("2026-06-20", "x", "X", 0, 4)]; // created 4
    const used = cityDailyValues(series, TODAY, "used").get("x")!;
    expect(used.values.every((v) => v === 0)).toBe(true);
    // plotted 18,19,20,21,22 → created 4 lands on 20 (index 2)
    expect(cityDailyValues(series, TODAY, "created").get("x")!.values).toEqual([
      0, 0, 4, 0, 0,
    ]);
  });

  it("keys the null-city bucket under __none__", () => {
    const series = [pt("2026-06-21", null, null, 3)];
    expect(cityDailyValues(series, TODAY, "used").has("__none__")).toBe(true);
  });
});
