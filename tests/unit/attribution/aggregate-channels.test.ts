import { describe, it, expect } from "vitest";
import { aggregateChannels } from "@/lib/attribution/aggregate-channels";

describe("aggregateChannels", () => {
  it("counts channels and null, with Desconocido present and last", () => {
    // Pre-grouped count-rows (one per channel) from the attribution_breakdown RPC.
    const rows = [
      { attribution_channel: "google_ads", count: 3 },
      { attribution_channel: "meta_ads", count: 1 },
      { attribution_channel: null, count: 2 },
    ];

    const { total, stats } = aggregateChannels(rows);

    // total is the SUM of counts, not the number of rows.
    expect(total).toBe(6);
    // Only channels that appear, in display order, Desconocido last.
    expect(stats.map((s) => s.channel)).toEqual([
      "google_ads",
      "meta_ads",
      null,
    ]);

    const google = stats.find((s) => s.channel === "google_ads")!;
    expect(google).toMatchObject({ label: "Google Ads", count: 3, pct: 50 });

    const meta = stats.find((s) => s.channel === "meta_ads")!;
    expect(meta).toMatchObject({ label: "Meta Ads", count: 1 });
    expect(meta.pct).toBeCloseTo(16.7, 5);

    const unknown = stats[stats.length - 1];
    expect(unknown).toMatchObject({
      channel: null,
      label: "Desconocido",
      count: 2,
    });
    expect(unknown.pct).toBeCloseTo(33.3, 5);

    // Percentages sum to ~100.
    const pctSum = stats.reduce((sum, s) => sum + s.pct, 0);
    expect(pctSum).toBeCloseTo(100, 5);
  });

  it("uses google_ads pct 60 / Desconocido pct 40 for a 3+2 split", () => {
    const rows = [
      { attribution_channel: "google_ads", count: 3 },
      { attribution_channel: null, count: 2 },
    ];

    const { total, stats } = aggregateChannels(rows);

    expect(total).toBe(5);
    expect(stats.map((s) => s.channel)).toEqual(["google_ads", null]);
    expect(stats.find((s) => s.channel === "google_ads")!.pct).toBe(60);
    // Desconocido (null) is last with pct 40.
    expect(stats[stats.length - 1]).toMatchObject({ channel: null, pct: 40 });
  });

  it("returns total 0 and empty stats for empty input", () => {
    expect(aggregateChannels([])).toEqual({ total: 0, stats: [] });
  });

  it("buckets an unexpected/non-enum channel string under 'other'", () => {
    const rows = [
      { attribution_channel: "google_ads", count: 2 },
      { attribution_channel: "weird", count: 4 },
      { attribution_channel: "other", count: 1 },
    ];

    const { total, stats } = aggregateChannels(rows);

    expect(total).toBe(7);
    // No bogus channel leaks through; its count folds into 'other' alongside the real one.
    expect(stats.map((s) => s.channel)).toEqual(["google_ads", "other"]);

    const other = stats.find((s) => s.channel === "other")!;
    // weird (4) + other (1) bucketed together — nothing dropped.
    expect(other).toMatchObject({ label: "Otro", count: 5 });

    // Total is preserved — nothing dropped — so pct still sums to ~100.
    const pctSum = stats.reduce((sum, s) => sum + s.pct, 0);
    expect(pctSum).toBeCloseTo(100, 5);
  });

  it("orders stats by ATTRIBUTION_CHANNELS with null last", () => {
    // Intentionally out of order in the input.
    const rows = [
      { attribution_channel: null, count: 1 },
      { attribution_channel: "direct", count: 1 },
      { attribution_channel: "meta_ads", count: 1 },
      { attribution_channel: "google_ads", count: 1 },
      { attribution_channel: "organic", count: 1 },
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
      { attribution_channel: "google_ads", count: 1 },
      { attribution_channel: "meta_ads", count: 1 },
      { attribution_channel: "organic", count: 1 },
    ];

    const { stats } = aggregateChannels(rows);
    for (const s of stats) {
      expect(s.pct).toBeCloseTo(33.3, 5);
    }
  });
});
