import { describe, it, expect } from "vitest";
import {
  rankCityMomentum,
  momentumWindowLabels,
  cityDailyValues,
} from "@/app/(dashboard)/analytics/cities/momentum";
import { NO_CITY_LABEL } from "@/app/(dashboard)/analytics/cities/pivot";
import type { CityDailyPoint } from "@/lib/queries/analytics";

const TODAY = "2026-06-22";
// recent = 21/20/19, prior = 18/17/16, excluded = 22 (today) and 15 (day-7).

function pt(
  day: string,
  city_id: string | null,
  city_name: string | null,
  used = 0,
  created = 0
): CityDailyPoint {
  return { day, city_id, city_name, used_count: used, created_count: created };
}

describe("rankCityMomentum", () => {
  const series: CityDailyPoint[] = [
    // Medellín: recent 9 (5+3+1), prior 2 → +7 rising
    pt("2026-06-21", "m", "Medellín", 5),
    pt("2026-06-20", "m", "Medellín", 3),
    pt("2026-06-19", "m", "Medellín", 1),
    pt("2026-06-18", "m", "Medellín", 2),
    // Cali: recent 4, prior 0 → +4 rising, nuevo
    pt("2026-06-21", "c", "Cali", 4),
    // Bogotá: recent 14, prior 25 → -11 falling
    pt("2026-06-20", "b", "Bogotá", 14),
    pt("2026-06-17", "b", "Bogotá", 25),
    // Equal: recent 3 == prior 3 → excluded from both
    pt("2026-06-19", "e", "Equilibrio", 3),
    pt("2026-06-16", "e", "Equilibrio", 3),
    // Today only (22) and day-7 (15) → outside both windows, ignored
    pt("2026-06-22", "t", "Tunja", 99),
    pt("2026-06-15", "v", "Vieja", 99),
  ];

  it("splits cities into rising and falling by recent-vs-prior delta", () => {
    const { rising, falling } = rankCityMomentum(series, TODAY, "used");
    expect(rising.map((r) => r.cityName)).toEqual(["Medellín", "Cali"]);
    expect(rising[0].delta).toBe(7);
    expect(rising[1].delta).toBe(4);
    expect(falling.map((r) => r.cityName)).toEqual(["Bogotá"]);
    expect(falling[0].delta).toBe(-11);
  });

  it("flags a city that started from zero as nuevo", () => {
    const { rising } = rankCityMomentum(series, TODAY, "used");
    const cali = rising.find((r) => r.cityName === "Cali")!;
    expect(cali.prior).toBe(0);
    expect(cali.recent).toBe(4);
    expect(cali.isNew).toBe(true);
    expect(rising.find((r) => r.cityName === "Medellín")!.isNew).toBe(false);
  });

  it("excludes today and the 7th day, and zero-delta cities", () => {
    const { rising, falling } = rankCityMomentum(series, TODAY, "used");
    const all = [...rising, ...falling].map((r) => r.cityName);
    expect(all).not.toContain("Tunja"); // today only
    expect(all).not.toContain("Vieja"); // day-7
    expect(all).not.toContain("Equilibrio"); // delta 0
  });

  it("reads the created metric independently of used", () => {
    const created: CityDailyPoint[] = [
      pt("2026-06-21", "x", "Xerox", 0, 6),
      pt("2026-06-18", "x", "Xerox", 0, 1),
    ];
    expect(rankCityMomentum(created, TODAY, "used").rising).toEqual([]);
    const { rising } = rankCityMomentum(created, TODAY, "created");
    expect(rising[0].cityName).toBe("Xerox");
    expect(rising[0].delta).toBe(5);
  });

  it("labels the null-city bucket", () => {
    const s = [pt("2026-06-21", null, null, 3)];
    const { rising } = rankCityMomentum(s, TODAY, "used");
    expect(rising[0].cityName).toBe(NO_CITY_LABEL);
    expect(rising[0].isNew).toBe(true);
  });
});

describe("cityDailyValues", () => {
  it("builds a 7-slot oldest→newest array per city, filling gaps with 0", () => {
    // today 22 → slots map to 16,17,18,19,20,21,22.
    const series: CityDailyPoint[] = [
      pt("2026-06-16", "m", "Medellín", 1),
      pt("2026-06-19", "m", "Medellín", 3),
      pt("2026-06-22", "m", "Medellín", 5),
    ];
    const spark = cityDailyValues(series, TODAY, "used").get("m")!;
    expect(spark.values).toEqual([1, 0, 0, 3, 0, 0, 5]);
  });

  it("flags trend up/down from recent 3 vs prior 3 (today excluded)", () => {
    // prior days (16,17,18) sum vs recent (19,20,21); slot 6 (today) ignored.
    const up: CityDailyPoint[] = [
      pt("2026-06-18", "a", "A", 1),
      pt("2026-06-20", "a", "A", 6),
    ];
    expect(cityDailyValues(up, TODAY, "used").get("a")!.trend).toBe("up");

    const down: CityDailyPoint[] = [
      pt("2026-06-17", "b", "B", 8),
      pt("2026-06-21", "b", "B", 1),
    ];
    expect(cityDailyValues(down, TODAY, "used").get("b")!.trend).toBe("down");
  });

  it("ignores days outside the 7-day window", () => {
    const series: CityDailyPoint[] = [pt("2026-06-15", "out", "Out", 9)]; // day-7
    expect(cityDailyValues(series, TODAY, "used").has("out")).toBe(false);
  });

  it("respects the metric (created vs used)", () => {
    const series: CityDailyPoint[] = [pt("2026-06-20", "x", "X", 0, 4)]; // created 4
    const used = cityDailyValues(series, TODAY, "used").get("x")!;
    expect(used.values.every((v) => v === 0)).toBe(true);
    expect(cityDailyValues(series, TODAY, "created").get("x")!.values).toEqual([
      0, 0, 0, 0, 4, 0, 0,
    ]);
  });
});

describe("momentumWindowLabels", () => {
  it("shows the recent and prior 3-day windows", () => {
    // today 22 → recent 19–21, prior 16–18.
    expect(momentumWindowLabels("2026-06-22")).toEqual({
      recent: "19–21 jun",
      prior: "16–18 jun",
    });
  });

  it("spans the month boundary", () => {
    // today 2 jun → recent 30 may–1 jun, prior 27–29 may.
    expect(momentumWindowLabels("2026-06-02")).toEqual({
      recent: "30 may–1 jun",
      prior: "27–29 may",
    });
  });
});
