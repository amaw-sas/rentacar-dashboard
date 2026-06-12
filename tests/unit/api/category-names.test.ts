import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type CategoryRow = { code: string; name: string };

type MockSpies = {
  from: ReturnType<typeof vi.fn>;
  companySelect: ReturnType<typeof vi.fn>;
  companyEq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  categoriesSelect: ReturnType<typeof vi.fn>;
  categoriesEq: ReturnType<typeof vi.fn>;
};

/**
 * Builds a Supabase admin-client mock for the two-query chain of
 * `getCategoryNameMap`:
 *   1. rental_companies: `from().select("id").eq("code","localiza").single()`
 *      → resolves `{ data: { id }, error }` (a Promise, via `.single()`).
 *   2. vehicle_categories: `from().select(COLUMNS).eq("rental_company_id", id)`
 *      → thenable builder resolving `{ data: rows, error }` (no `.single()`).
 * `from` is called twice and returns the matching builder per call, so we can
 * spy on the exact call sequence and thread the resolved company id.
 */
function createMockSupabase(opts: {
  companyId?: string;
  companyError?: { message: string } | null;
  rows?: CategoryRow[];
  categoriesError?: { message: string } | null;
  // When true, `from` dispatches builders by table-name argument
  // (mockImplementation) instead of by call order (mockReturnValueOnce ×2), so a
  // single client serves N repeated fetches with the same rows. Required for the
  // cache scenarios where a leaked/concurrent 2nd fetch must reach its assertion
  // (observe `from` 4×) instead of crashing on an exhausted once-queue (#129).
  repeating?: boolean;
}): { client: unknown; spies: MockSpies } {
  const companyResult = {
    data: opts.companyId === undefined ? null : { id: opts.companyId },
    error: opts.companyError ?? null,
  };
  const categoriesResult = {
    data: opts.rows ?? [],
    error: opts.categoriesError ?? null,
  };

  // First query builder: rental_companies, terminating in `.single()`.
  const companyEq = vi.fn();
  const single = vi.fn().mockResolvedValue(companyResult);
  const companyBuilder = { eq: companyEq, single };
  companyEq.mockReturnValue(companyBuilder);
  const companySelect = vi.fn().mockReturnValue(companyBuilder);

  // Second query builder: vehicle_categories, thenable (awaited directly).
  const categoriesEq = vi.fn();
  const categoriesBuilder = {
    eq: categoriesEq,
    then: (resolve: (value: typeof categoriesResult) => unknown) =>
      resolve(categoriesResult),
  };
  categoriesEq.mockReturnValue(categoriesBuilder);
  const categoriesSelect = vi.fn().mockReturnValue(categoriesBuilder);

  const from = opts.repeating
    ? vi
        .fn()
        .mockImplementation((table: string) =>
          table === "rental_companies"
            ? { select: companySelect }
            : { select: categoriesSelect },
        )
    : vi
        .fn()
        .mockReturnValueOnce({ select: companySelect })
        .mockReturnValueOnce({ select: categoriesSelect });

  const client = { from };

  return {
    client,
    spies: {
      from,
      companySelect,
      companyEq,
      single,
      categoriesSelect,
      categoriesEq,
    },
  };
}

const SAMPLE_ROWS: CategoryRow[] = [
  { code: "C", name: "Gama C Económico Mecánico" },
  { code: "FX", name: "Gama FX Sedán Automático" },
];

async function loadModule(client: unknown) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return import("@/lib/api/category-names");
}

// Point `createAdminClient` at a fresh client so the NEXT fetch (a cache miss or
// expiry refetch) runs against different rows / an error→success flip, without
// resetting the module under test. Works because `fetchCategoryNameMap` calls
// `createAdminClient()` anew on every fetch (it caches the Map, not the client).
async function rebind(client: unknown) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

const RENAMED_ROWS: CategoryRow[] = [{ code: "C", name: "Gama C RENOMBRADA" }];
const FIXED_NOW = new Date("2026-06-11T00:00:00.000Z").getTime();

describe("getCategoryNameMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // SCEN-007.1: the two queries hit rental_companies then vehicle_categories, in order.
  it("queries rental_companies then vehicle_categories, in sequence", async () => {
    const { client, spies } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap } = await loadModule(client);

    await getCategoryNameMap();

    expect(spies.from).toHaveBeenNthCalledWith(1, "rental_companies");
    expect(spies.from).toHaveBeenNthCalledWith(2, "vehicle_categories");
  });

  // SCEN-007.2: first query resolves the Localiza company by unique code via .single().
  it("resolves the company with select('id'), eq('code','localiza'), .single()", async () => {
    const { client, spies } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap } = await loadModule(client);

    await getCategoryNameMap();

    expect(spies.companySelect).toHaveBeenCalledWith("id");
    expect(spies.companyEq).toHaveBeenCalledWith("code", "localiza");
    expect(spies.single).toHaveBeenCalledTimes(1);
  });

  // SCEN-007.3: the resolved company id is threaded into the category filter —
  // heart of the §139 invariant (filter by company, not global code).
  it("projects CATEGORY_NAME_COLUMNS and filters categories by the resolved company id", async () => {
    const { client, spies } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap, CATEGORY_NAME_COLUMNS } =
      await loadModule(client);

    await getCategoryNameMap();

    expect(spies.categoriesSelect).toHaveBeenCalledWith(
      CATEGORY_NAME_COLUMNS.join(", "),
    );
    expect(spies.categoriesEq).toHaveBeenCalledWith(
      "rental_company_id",
      "loc-uuid-123",
    );
  });

  // SCEN-007.4a: an error from the FIRST query throws (no partial success).
  // `companyId` is supplied so `data` is a valid object — the ONLY thing that
  // can throw is the `companyError` guard, not a null deref. This keeps the
  // assertion attributable to the error contract.
  it("throws when the company lookup returns an error", async () => {
    const { client } = createMockSupabase({
      companyId: "loc-uuid-123",
      companyError: { message: "connection refused" },
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap } = await loadModule(client);

    await expect(getCategoryNameMap()).rejects.toThrow();
  });

  // SCEN-007.4b: an error from the SECOND query throws.
  it("throws when the categories query returns an error", async () => {
    const { client } = createMockSupabase({
      companyId: "loc-uuid-123",
      categoriesError: { message: "connection refused" },
    });
    const { getCategoryNameMap } = await loadModule(client);

    await expect(getCategoryNameMap()).rejects.toThrow();
  });

  // SCEN-007.5: returns a Map<code,name> whose entries equal the mocked rows.
  it("returns a Map whose entries equal the queried rows", async () => {
    const { client } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap } = await loadModule(client);

    const map = await getCategoryNameMap();

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(2);
    expect(map.get("C")).toBe("Gama C Económico Mecánico");
    expect(map.get("FX")).toBe("Gama FX Sedán Automático");
  });

  // SCEN-007.6: the projection constant is exported and stable.
  it("exports CATEGORY_NAME_COLUMNS as ['code','name']", async () => {
    const { client } = createMockSupabase({ companyId: "x", rows: [] });
    const { CATEGORY_NAME_COLUMNS } = await loadModule(client);

    expect(CATEGORY_NAME_COLUMNS).toEqual(["code", "name"]);
  });
});

// Issue #129 — TTL cache + single-flight. Module-level `cache`/`inflight` state is
// reset between tests by `vi.resetModules()` (load-bearing — see SCEN-009 isolation
// note); `vi.useRealTimers()` in afterEach prevents fake-clock leakage.
describe("getCategoryNameMap cache (issue #129)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // SCEN-009: a second lookup within the TTL is served from cache — the DB is
  // queried only once. Red (no cache): two fetches → `from` 4×.
  it("serves a cache hit within the TTL without re-querying the DB", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const { client, spies } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
      repeating: true,
    });
    const { getCategoryNameMap } = await loadModule(client);

    const first = await getCategoryNameMap();
    vi.setSystemTime(FIXED_NOW + 4 * 60_000); // +4 min, still < 5 min TTL
    const second = await getCategoryNameMap();

    expect(spies.from).toHaveBeenCalledTimes(2); // one fetch only
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  // SCEN-010: once the TTL elapses, the next lookup re-queries and reflects the
  // new rows. Staleness is bounded by the TTL.
  it("refetches after the TTL expires and reflects new rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const first = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap, CATEGORY_NAME_TTL_MS } =
      await loadModule(first.client);

    const before = await getCategoryNameMap();
    expect(before.get("C")).toBe("Gama C Económico Mecánico");

    const refreshed = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: RENAMED_ROWS,
    });
    await rebind(refreshed.client);
    vi.setSystemTime(FIXED_NOW + CATEGORY_NAME_TTL_MS); // exactly at expiry (exclusive) → refetch
    const after = await getCategoryNameMap();

    expect(after.get("C")).toBe("Gama C RENOMBRADA");
  });

  // SCEN-011: a failed fetch is NOT cached — the next call retries and can succeed.
  it("does not cache a failure and retries on the next call", async () => {
    const failing = createMockSupabase({
      companyId: "loc-uuid-123",
      companyError: { message: "connection refused" },
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap } = await loadModule(failing.client);

    await expect(getCategoryNameMap()).rejects.toThrow();

    const recovered = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    await rebind(recovered.client);
    const map = await getCategoryNameMap();

    expect(map.get("C")).toBe("Gama C Económico Mecánico");
  });

  // SCEN-012: two concurrent cold-start calls share one fetch (single-flight).
  // Red (no single-flight): two fetches → `from` 4×.
  it("dedupes concurrent cold-start calls into a single fetch", async () => {
    const { client, spies } = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
      repeating: true,
    });
    const { getCategoryNameMap } = await loadModule(client);

    const [a, b] = await Promise.all([
      getCategoryNameMap(),
      getCategoryNameMap(),
    ]);

    expect(spies.from).toHaveBeenCalledTimes(2); // one shared fetch
    expect(a).toBe(b); // same Map instance from the shared in-flight promise
  });

  // SCEN-013: single-flight still holds on the expiry refetch path — two concurrent
  // calls after expiry trigger a single shared refetch. Red (no inflight guard):
  // the refetch client's `from` is called 4×.
  it("dedupes concurrent calls into a single refetch after expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const first = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: SAMPLE_ROWS,
    });
    const { getCategoryNameMap, CATEGORY_NAME_TTL_MS } =
      await loadModule(first.client);

    await getCategoryNameMap(); // populate cache

    const refetch = createMockSupabase({
      companyId: "loc-uuid-123",
      rows: RENAMED_ROWS,
      repeating: true,
    });
    await rebind(refetch.client);
    vi.setSystemTime(FIXED_NOW + CATEGORY_NAME_TTL_MS); // expired
    const [a, b] = await Promise.all([
      getCategoryNameMap(),
      getCategoryNameMap(),
    ]);

    expect(refetch.spies.from).toHaveBeenCalledTimes(2); // single shared refetch
    expect(a).toBe(b);
    expect(a.get("C")).toBe("Gama C RENOMBRADA");
  });
});
