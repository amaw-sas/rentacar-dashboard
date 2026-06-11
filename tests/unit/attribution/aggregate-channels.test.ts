import { describe, it, expect } from "vitest";
import { aggregateChannels } from "@/lib/attribution/aggregate-channels";

describe("aggregateChannels", () => {
  it("counts channels and null, with Desconocido present and last", () => {
    const rows = [
      { attribution_channel: "google_ads" },
      { attribution_channel: "google_ads" },
      { attribution_channel: "meta_ads" },
      { attribution_channel: null },
    ];

    const { total, stats } = aggregateChannels(rows);

    expect(total).toBe(4);
    // Only channels that appear, in display order, Desconocido last.
    expect(stats.map((s) => s.channel)).toEqual([
      "google_ads",
      "meta_ads",
      null,
    ]);

    const google = stats.find((s) => s.channel === "google_ads")!;
    expect(google).toMatchObject({ label: "Google Ads", count: 2, pct: 50 });

    const meta = stats.find((s) => s.channel === "meta_ads")!;
    expect(meta).toMatchObject({ label: "Meta Ads", count: 1, pct: 25 });

    const unknown = stats[stats.length - 1];
    expect(unknown).toMatchObject({
      channel: null,
      label: "Desconocido",
      count: 1,
      pct: 25,
    });

    // Percentages sum to ~100.
    const pctSum = stats.reduce((sum, s) => sum + s.pct, 0);
    expect(pctSum).toBeCloseTo(100, 5);
  });

  it("returns total 0 and empty stats for empty input", () => {
    expect(aggregateChannels([])).toEqual({ total: 0, stats: [] });
  });

  it("buckets an unexpected/non-enum channel string under 'other'", () => {
    const rows = [
      { attribution_channel: "google_ads" },
      { attribution_channel: "totally_bogus_channel" },
      { attribution_channel: "other" },
    ];

    const { total, stats } = aggregateChannels(rows);

    expect(total).toBe(3);
    // No bogus channel leaks through; it folds into 'other' alongside the real one.
    expect(stats.map((s) => s.channel)).toEqual(["google_ads", "other"]);

    const other = stats.find((s) => s.channel === "other")!;
    expect(other).toMatchObject({ label: "Otro", count: 2 });

    // Total is preserved — nothing dropped — so pct still sums to ~100.
    const pctSum = stats.reduce((sum, s) => sum + s.pct, 0);
    expect(pctSum).toBeCloseTo(100, 5);
  });

  it("orders stats by ATTRIBUTION_CHANNELS with null last", () => {
    // Intentionally out of order in the input.
    const rows = [
      { attribution_channel: null },
      { attribution_channel: "direct" },
      { attribution_channel: "meta_ads" },
      { attribution_channel: "google_ads" },
      { attribution_channel: "organic" },
    ];

    const { stats } = aggregateChannels(rows);

    // Canonical order: google_ads < meta_ads < organic < direct, null last.
    expect(stats.map((s) => s.channel)).toEqual([
      "google_ads",
      "meta_ads",
      "organic",
      "direct",
      null,
    ]);
  });

  it("rounds pct to one decimal", () => {
    // 1 of 3 → 33.333... → 33.3
    const rows = [
      { attribution_channel: "google_ads" },
      { attribution_channel: "meta_ads" },
      { attribution_channel: "organic" },
    ];

    const { stats } = aggregateChannels(rows);
    for (const s of stats) {
      expect(s.pct).toBeCloseTo(33.3, 5);
    }
  });
});
