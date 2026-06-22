import { describe, it, expect } from "vitest";
import { rankCityMomentum } from "@/app/(dashboard)/analytics/cities/momentum";
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
