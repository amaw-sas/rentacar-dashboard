import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type LocationRow = {
  slug: string;
  code: string;
  city: string;
  name: string;
  status: string;
  pickup_address: string;
  pickup_map: string;
  schedule: Record<string, string>;
};

type MockSpies = {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
};

/**
 * Builds a Supabase query-builder mock for the
 * `from().select().eq().order().order()` chain. The builder is thenable so the
 * final `await` resolves to `{ data, error }`; every chain method returns the
 * same builder, letting us spy on the exact call sequence.
 */
function createMockSupabase(opts: {
  rows?: LocationRow[];
  error?: { message: string } | null;
}): { client: unknown; spies: MockSpies } {
  const result = { data: opts.rows ?? [], error: opts.error ?? null };

  const eq = vi.fn();
  const order = vi.fn();
  const builder = {
    eq,
    order,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  eq.mockReturnValue(builder);
  order.mockReturnValue(builder);

  const select = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ select });
  const client = { from };

  return { client, spies: { from, select, eq, order } };
}

const SAMPLE_ROWS: LocationRow[] = [
  {
    slug: "armenia-aeropuerto",
    code: "AARME",
    city: "armenia",
    name: "Armenia Aeropuerto",
    status: "active",
    pickup_address: "Aeropuerto el Edén",
    pickup_map: "https://maps.app.goo.gl/x",
    schedule: { display: "Lun-Vie 06:00-19:00" },
  },
];

async function loadModule(client: unknown) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return import("@/lib/api/location-directory");
}

describe("getLocationDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // SCEN-001 (query-shape half) — the projection equals DIRECTORY_COLUMNS and
  // the active filter + city→name ordering are applied as a call chain. The
  // runtime half (count:31, observable order over real data) lives in Step 2.
  it("projects exactly DIRECTORY_COLUMNS and queries the locations table", async () => {
    const { client, spies } = createMockSupabase({ rows: SAMPLE_ROWS });
    const { getLocationDirectory, DIRECTORY_COLUMNS } = await loadModule(client);

    await getLocationDirectory();

    expect(spies.from).toHaveBeenCalledWith("locations");
    expect(spies.select).toHaveBeenCalledWith(DIRECTORY_COLUMNS.join(", "));
  });

  it("applies the active filter then orders by city then name, in sequence", async () => {
    const { client, spies } = createMockSupabase({ rows: SAMPLE_ROWS });
    const { getLocationDirectory } = await loadModule(client);

    await getLocationDirectory();

    // SCEN-002: active filter is applied at the query layer.
    expect(spies.eq).toHaveBeenCalledWith("status", "active");

    // SCEN-001: ordering is city then name (asserting the call chain, not mock
    // output order — the latter would be tautological).
    expect(spies.order).toHaveBeenNthCalledWith(1, "city");
    expect(spies.order).toHaveBeenNthCalledWith(2, "name");

    // Sequence: eq before the first order.
    const eqOrder = spies.eq.mock.invocationCallOrder[0];
    const cityOrder = spies.order.mock.invocationCallOrder[0];
    const nameOrder = spies.order.mock.invocationCallOrder[1];
    expect(eqOrder).toBeLessThan(cityOrder);
    expect(cityOrder).toBeLessThan(nameOrder);
  });

  it("returns the rows the query yields", async () => {
    const { client } = createMockSupabase({ rows: SAMPLE_ROWS });
    const { getLocationDirectory } = await loadModule(client);

    const result = await getLocationDirectory();

    expect(result).toEqual(SAMPLE_ROWS);
  });

  // SCEN-007: a Supabase error throws rather than returning a partial/empty success.
  it("throws when the query returns an error", async () => {
    const { client } = createMockSupabase({
      rows: [],
      error: { message: "connection refused" },
    });
    const { getLocationDirectory } = await loadModule(client);

    await expect(getLocationDirectory()).rejects.toThrow();
  });

  it("exports DIRECTORY_COLUMNS as the 8-field projection", async () => {
    const { client } = createMockSupabase({ rows: [] });
    const { DIRECTORY_COLUMNS } = await loadModule(client);

    expect(DIRECTORY_COLUMNS).toEqual([
      "slug",
      "code",
      "city",
      "name",
      "status",
      "pickup_address",
      "pickup_map",
      "schedule",
    ]);
  });
});
