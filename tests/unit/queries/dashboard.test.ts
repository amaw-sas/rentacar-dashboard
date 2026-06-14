import { describe, it, expect, beforeEach, vi } from "vitest";

// Contract test for the count queries the dashboard cards build (issue #114).
// It pins the query shape each card requires — period counts keyed by
// created_at (with "ayer" as a closed range) and "Utilizadas este mes" keyed by
// status='utilizado' + pickup_date range — and that totals equal the sum of the
// per-franchise breakdown. Real DB semantics are validated at runtime.

interface Q {
  eq: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
}

let queries: Q[] = [];
let countFor: (q: Q) => number = () => 0;

function makeChain() {
  const q: Q = { eq: [], gte: [], lte: [] };
  queries.push(q);
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => {
      q.eq.push([c, v]);
      return chain;
    },
    gte: (c: string, v: unknown) => {
      q.gte.push([c, v]);
      return chain;
    },
    lte: (c: string, v: unknown) => {
      q.lte.push([c, v]);
      return chain;
    },
    // Thenable: the count queries are awaited directly (no terminal .range).
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ count: countFor(q), error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeChain() }),
}));

import {
  getReservationCounts,
  getUsedThisMonth,
} from "@/lib/queries/dashboard";

const franchiseOf = (q: Q) =>
  q.eq.find(([c]) => c === "franchise")?.[1] as string | undefined;

beforeEach(() => {
  queries = [];
  countFor = () => 0;
});

describe("getReservationCounts", () => {
  it("labels periods and sums the per-franchise breakdown", async () => {
    // Closed-range (yesterday) returns base*10 so it is distinguishable from the
    // open-ended periods (today/week/month), which all return base.
    countFor = (q) => {
      const base = franchiseOf(q) === "GR" ? 2 : franchiseOf(q) === "C" ? 3 : 0;
      return q.lte.length > 0 ? base * 10 : base;
    };

    const r = await getReservationCounts(["GR", "C"]);

    expect(r.today.byFranchise).toEqual({ GR: 2, C: 3 });
    expect(r.today.total).toBe(5);
    expect(r.week.total).toBe(5);
    expect(r.month.total).toBe(5);
    expect(r.yesterday.byFranchise).toEqual({ GR: 20, C: 30 });
    expect(r.yesterday.total).toBe(50);
  });

  it("counts by created_at, and only 'ayer' is a closed range", async () => {
    countFor = () => 0;
    await getReservationCounts(["GR", "C"]);

    // 4 periods × 2 franchises = 8 count queries.
    expect(queries).toHaveLength(8);
    // Every period filters created_at (never pickup_date).
    expect(
      queries.every((q) => q.gte.some(([c]) => c === "created_at"))
    ).toBe(true);
    expect(
      queries.some((q) => q.gte.some(([c]) => c === "pickup_date"))
    ).toBe(false);
    // Exactly the two "ayer" queries (one per franchise) have an upper bound.
    expect(queries.filter((q) => q.lte.length > 0)).toHaveLength(2);
  });
});

describe("getUsedThisMonth", () => {
  it("filters status='utilizado' on a pickup_date range and sums by franchise", async () => {
    countFor = (q) => (franchiseOf(q) === "GR" ? 4 : franchiseOf(q) === "C" ? 1 : 0);

    const u = await getUsedThisMonth(["GR", "C"]);

    expect(u.byFranchise).toEqual({ GR: 4, C: 1 });
    expect(u.total).toBe(5);

    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(q.eq).toContainEqual(["status", "utilizado"]);
      expect(q.gte.some(([c]) => c === "pickup_date")).toBe(true);
      expect(q.lte.some(([c]) => c === "pickup_date")).toBe(true);
      // Used-this-month is recogida-based, NOT creation-based.
      expect(q.gte.some(([c]) => c === "created_at")).toBe(false);
    }
  });
});
