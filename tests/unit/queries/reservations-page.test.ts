import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseListParams } from "@/lib/reservations/list-params";

// Contract test for the PostgREST query getReservationsPage builds. It pins the
// query shape the scenarios require (snapshot-keyed search, city→location
// resolution, priority ordering, range); the real DB semantics are validated
// separately against prod via the Supabase MCP (see the scenarios file).

type Recorder = {
  reservations: {
    select: { sel: string; opts: unknown } | null;
    eq: Array<[string, unknown]>;
    in: Array<[string, unknown]>;
    is: Array<[string, unknown]>;
    gte: Array<[string, unknown]>;
    lte: Array<[string, unknown]>;
    or: string[];
    order: Array<[string, unknown]>;
    range: [number, number] | null;
  };
  locationsEq: Array<[string, unknown]>;
  locationsData: Array<{ id: string }>;
  rows: unknown[];
  count: number;
};

let rec: Recorder;

function makeReservationsChain() {
  const r = rec.reservations;
  const result = { data: rec.rows, error: null, count: rec.count };
  const chain: Record<string, unknown> = {
    select: (sel: string, opts: unknown) => {
      r.select = { sel, opts };
      return chain;
    },
    eq: (c: string, v: unknown) => {
      r.eq.push([c, v]);
      return chain;
    },
    in: (c: string, v: unknown) => {
      r.in.push([c, v]);
      return chain;
    },
    is: (c: string, v: unknown) => {
      r.is.push([c, v]);
      return chain;
    },
    gte: (c: string, v: unknown) => {
      r.gte.push([c, v]);
      return chain;
    },
    lte: (c: string, v: unknown) => {
      r.lte.push([c, v]);
      return chain;
    },
    or: (e: string) => {
      r.or.push(e);
      return chain;
    },
    order: (c: string, o: unknown) => {
      r.order.push([c, o]);
      return chain;
    },
    range: (a: number, b: number) => {
      r.range = [a, b];
      return Promise.resolve(result);
    },
  };
  return chain;
}

function makeLocationsChain() {
  // Thenable + chainable: `await from('locations').select('id').eq(...)`.
  const result = { data: rec.locationsData, error: null };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => {
      rec.locationsEq.push([c, v]);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      table === "locations" ? makeLocationsChain() : makeReservationsChain(),
  }),
}));

import { getReservationsPage } from "@/lib/queries/reservations";

function freshRecorder(): Recorder {
  return {
    reservations: {
      select: null,
      eq: [],
      in: [],
      is: [],
      gte: [],
      lte: [],
      or: [],
      order: [],
      range: null,
    },
    locationsEq: [],
    locationsData: [],
    rows: [],
    count: 0,
  };
}

function run(query: string) {
  return getReservationsPage(parseListParams(new URLSearchParams(query)));
}

beforeEach(() => {
  rec = freshRecorder();
});

describe("getReservationsPage — query construction", () => {
  it("selects with an exact count for pagination", async () => {
    await run("");
    expect(rec.reservations.select?.opts).toEqual({ count: "exact" });
  });

  it("orders by is_priority first, then the sort column, then id (stable)", async () => {
    await run("sort=pickup:asc");
    expect(rec.reservations.order).toEqual([
      ["is_priority", { ascending: false }],
      ["pickup_date", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("defaults to created_at desc when no sort is given (SCEN-010/011)", async () => {
    await run("");
    expect(rec.reservations.order[1]).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("ranges to one page: page 2 → rows 20..39 (SCEN-006)", async () => {
    await run("page=2");
    expect(rec.reservations.range).toEqual([20, 39]);
  });

  it("applies status as an eq filter (SCEN-003)", async () => {
    await run("status=pendiente");
    expect(rec.reservations.eq).toContainEqual(["status", "pendiente"]);
  });

  it("applies a concrete Origen channel as an eq filter (SCEN-008)", async () => {
    await run("origen=google_ads");
    expect(rec.reservations.eq).toContainEqual([
      "attribution_channel",
      "google_ads",
    ]);
    // A concrete channel never goes through the IS NULL path.
    expect(rec.reservations.is).toEqual([]);
  });

  it("maps the Desconocido sentinel to attribution_channel IS NULL (SCEN-008)", async () => {
    await run("origen=__unknown__");
    expect(rec.reservations.is).toContainEqual(["attribution_channel", null]);
    // Desconocido must not collapse into an eq filter on a literal.
    expect(rec.reservations.eq).not.toContainEqual([
      "attribution_channel",
      "__unknown__",
    ]);
  });

  it("applies no attribution filter when Origen is absent (SCEN-008)", async () => {
    await run("");
    expect(rec.reservations.is).toEqual([]);
    for (const [col] of rec.reservations.eq) {
      expect(col).not.toBe("attribution_channel");
    }
  });

  it("resolves city → location ids and filters pickup_location_id (SCEN-005)", async () => {
    rec.locationsData = [{ id: "loc-a" }, { id: "loc-b" }];
    await run("city=city-1");
    expect(rec.locationsEq).toContainEqual(["city_id", "city-1"]);
    expect(rec.reservations.in).toContainEqual([
      "pickup_location_id",
      ["loc-a", "loc-b"],
    ]);
  });

  it("anchors the created_at range to Colombia time, inclusive (SCEN-007, issue #115)", async () => {
    await run("created_from=2026-05-01&created_to=2026-05-31");
    // Lower bound = 00:00 Colombia of May 1 = 05:00Z; upper bound = last ms of
    // May 31 Colombia = Jun 1 04:59:59.999Z. Bare UTC dates (the prior bug) would
    // misattribute reservations created 19:00–24:00 Colombia to the next day.
    expect(rec.reservations.gte).toContainEqual([
      "created_at",
      "2026-05-01T05:00:00.000Z",
    ]);
    expect(rec.reservations.lte).toContainEqual([
      "created_at",
      "2026-06-01T04:59:59.999Z",
    ]);
  });

  it("filters pickup_date range inclusively (date column, SCEN-007)", async () => {
    await run("pickup_from=2026-06-01&pickup_to=2026-06-30");
    expect(rec.reservations.gte).toContainEqual(["pickup_date", "2026-06-01"]);
    expect(rec.reservations.lte).toContainEqual(["pickup_date", "2026-06-30"]);
  });

  it("searches the snapshot columns + code + nota, never the live customers join (issue #26, #109, SCEN-004/SCEN-1)", async () => {
    await run("q=lopez");
    expect(rec.reservations.or).toHaveLength(1);
    const expr = rec.reservations.or[0];
    for (const col of [
      "customer_name_at_booking",
      "customer_identification_number_at_booking",
      "customer_email_at_booking",
      "customer_phone_at_booking",
      "reservation_code",
      "nota",
    ]) {
      expect(expr).toContain(`${col}.ilike.*lopez*`);
    }
    // The exact #26 guard: never search the live join.
    expect(expr).not.toContain("customers.");
  });

  it("sanitizes a search term with PostgREST-reserved chars (SCEN-012)", async () => {
    await run(`q=${encodeURIComponent("O'BRIEN, JOSE")}`);
    const expr = rec.reservations.or[0];
    // Comma stripped → no spurious extra filter; apostrophe preserved.
    expect(expr).toContain("customer_name_at_booking.ilike.*O'BRIEN JOSE*");
  });

  it("returns the page rows and the exact total", async () => {
    rec.rows = [{ id: "r1" }, { id: "r2" }];
    rec.count = 13003;
    const out = await run("");
    expect(out.rows).toEqual([{ id: "r1" }, { id: "r2" }]);
    expect(out.total).toBe(13003);
  });

  it("does not apply filters that are absent", async () => {
    await run("");
    expect(rec.reservations.eq).toEqual([]);
    expect(rec.reservations.in).toEqual([]);
    expect(rec.reservations.or).toEqual([]);
  });
});
