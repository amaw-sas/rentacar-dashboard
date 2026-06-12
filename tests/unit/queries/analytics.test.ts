import { describe, it, expect, beforeEach, vi } from "vitest";
import { bogotaDayStartISO, bogotaDayEndISO } from "@/lib/date/bogota";

// Contract test for the PostgREST range filters the analytics queries build.
// Issue #126: `from`/`to` arrive as Colombia civil dates ("YYYY-MM-DD") and must
// be anchored to the Colombia day boundary before comparing against the UTC
// `timestamptz` columns — otherwise a row at 22:00 Colombia (next UTC day) leaks
// into the wrong day (same defect as #114/#115). The mock records every gte/lte
// the query builder receives; the bogota helpers are the oracle.

type Recorder = {
  table: string | null;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  eq: Array<[string, unknown]>;
};

let rec: Recorder;

function makeChain() {
  const result = { data: [], error: null };
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    not: () => chain,
    eq: (c: string, v: unknown) => {
      rec.eq.push([c, v]);
      return chain;
    },
    gte: (c: string, v: unknown) => {
      rec.gte.push([c, v]);
      return chain;
    },
    lte: (c: string, v: unknown) => {
      rec.lte.push([c, v]);
      return chain;
    },
    // Terminal: `await query` resolves the PostgREST result.
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      rec.table = table;
      return makeChain();
    },
  }),
}));

import {
  getDemandStats,
  getConversionStats,
  getReferralPerformance,
  getRevenueStats,
} from "@/lib/queries/analytics";

beforeEach(() => {
  rec = { table: null, gte: [], lte: [], eq: [] };
});

const FROM = "2026-06-01";
const TO = "2026-06-09";

// A search/commission stamped 22:00 Colombia on the `to` day is 03:00Z the NEXT
// UTC day — the exact value the old bare-UTC `.lte(to)` would have excluded.
const LATE_ON_TO_DAY = new Date("2026-06-09T22:00:00-05:00").toISOString();

describe("analytics range filters anchor to Colombia time (#126)", () => {
  describe("getDemandStats (searched_at)", () => {
    it("anchors from/to to the Colombia day boundary (SCEN-1)", async () => {
      await getDemandStats({ from: FROM, to: TO });
      expect(rec.gte).toContainEqual(["searched_at", bogotaDayStartISO(FROM)]);
      expect(rec.lte).toContainEqual(["searched_at", bogotaDayEndISO(TO)]);
    });

    it("keeps a 22:00-Colombia row inside the upper bound (SCEN-1)", async () => {
      await getDemandStats({ from: FROM, to: TO });
      expect(LATE_ON_TO_DAY <= bogotaDayEndISO(TO)).toBe(true);
    });

    it("adds no bounds when from/to are absent (SCEN-5)", async () => {
      await getDemandStats({ franchise: "alquilatucarro" });
      expect(rec.gte).toHaveLength(0);
      expect(rec.lte).toHaveLength(0);
      expect(rec.eq).toContainEqual(["franchise", "alquilatucarro"]);
    });
  });

  describe("getConversionStats (searched_at)", () => {
    it("anchors from/to to the Colombia day boundary (SCEN-2)", async () => {
      await getConversionStats({ from: FROM, to: TO });
      expect(rec.gte).toContainEqual(["searched_at", bogotaDayStartISO(FROM)]);
      expect(rec.lte).toContainEqual(["searched_at", bogotaDayEndISO(TO)]);
    });
  });

  describe("getReferralPerformance (searched_at)", () => {
    it("anchors from/to to the Colombia day boundary (SCEN-3)", async () => {
      await getReferralPerformance({ from: FROM, to: TO });
      expect(rec.gte).toContainEqual(["searched_at", bogotaDayStartISO(FROM)]);
      expect(rec.lte).toContainEqual(["searched_at", bogotaDayEndISO(TO)]);
    });
  });

  describe("getRevenueStats (created_at)", () => {
    it("anchors from/to to the Colombia day boundary (SCEN-4)", async () => {
      await getRevenueStats({ from: FROM, to: TO });
      expect(rec.table).toBe("commissions");
      expect(rec.gte).toContainEqual(["created_at", bogotaDayStartISO(FROM)]);
      expect(rec.lte).toContainEqual(["created_at", bogotaDayEndISO(TO)]);
    });
  });
});
