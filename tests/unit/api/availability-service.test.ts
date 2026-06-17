import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Issue #72 Step 2: the availability core is extracted to `searchAvailability`
// (lib/api/availability-service.ts) so an in-process MCP server can call it
// without going through the HTTP route. These tests encode the holdout
// scenarios SCEN-001..004 against the SERVICE directly (the public-route
// contract is independently locked by availability-route.test.ts).
//
// Only `getCategoryNameMap` is mocked; the REAL `enrichCategoryDescriptions`
// runs so SCEN-001 proves the genuine PT→ES wiring, not a stubbed echo. The
// proxy is reached via global `fetch`, stubbed per-test.

vi.mock("@/lib/api/category-names", () => ({
  getCategoryNameMap: vi.fn(),
}));

// Capacity enrichment (#72) is layered after the name enrichment; mock its map
// so the service tests stay network-free. The REAL `enrichCategoryCapacity` runs.
vi.mock("@/lib/api/category-capacity", () => ({
  getCategoryCapacityMap: vi.fn(),
}));

const CAP_C = {
  passengerCount: 5,
  luggageCount: 4,
  transmission: "automatic" as const,
  hasAc: true,
  picoyplacaExempt: false,
};

// NOTE: `vi.resetModules()` in beforeEach gives each dynamically-imported
// service its own fresh module graph — so `ServiceError` must be imported
// dynamically ALONGSIDE the service (same graph) for `instanceof` to hold.
// A static top-level import would resolve to a different class instance.

// PT input as Localiza returns it; categoryCode is the join key into the ES map.
const PT_ITEMS = [
  {
    categoryCode: "C",
    categoryDescription: "ECONÔMICO COM AR",
    totalAmount: 100,
    estimatedTotalAmount: 119,
    taxFeeAmount: 5,
    IVAFeeAmount: 19,
    coverageQuantity: 0,
    coverageTotalAmount: 0,
    returnFeeAmount: 0,
    extraHoursQuantity: 0,
    extraHoursTotalAmount: 0,
    referenceToken: "tok-abc",
    rateQualifier: "RQ1",
  },
];

function proxyResponse(opts: {
  ok: boolean;
  status: number;
  json?: () => unknown;
  text?: () => string;
}) {
  return {
    ok: opts.ok,
    status: opts.status,
    json: async () => (opts.json ? opts.json() : undefined),
    text: async () => (opts.text ? opts.text() : ""),
  };
}

const VALID_INPUT = {
  pickupLocation: "BOG01",
  returnLocation: "BOG01",
  pickupDateTime: "2026-07-01T10:00",
  returnDateTime: "2026-07-05T10:00",
};

describe("searchAvailability (issue #72 Step 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LOCALIZA_PROXY_URL = "https://proxy.test";
    process.env.PROXY_API_KEY = "proxy-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // SCEN-001 — valid availability returns ES categories, raw price fields intact.
  it("SCEN-001: returns categories with ES description and untouched price fields", async () => {
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockResolvedValue(
      new Map([["C", "Gama C Económico Mecánico"]]),
    );
    const { getCategoryCapacityMap } = await import(
      "@/lib/api/category-capacity"
    );
    vi.mocked(getCategoryCapacityMap).mockResolvedValue(new Map([["C", CAP_C]]));
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const result = (await searchAvailability(VALID_INPUT)) as Array<
      Record<string, unknown>
    >;

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].categoryDescription).toBe("Gama C Económico Mecánico");
    // Capacity fields merged onto the matching gama.
    expect(result[0].passengerCount).toBe(5);
    expect(result[0].luggageCount).toBe(4);
    expect(result[0].transmission).toBe("automatic");
    expect(result[0].hasAc).toBe(true);
    expect(result[0].picoyplacaExempt).toBe(false);
    // Raw price + token fields survive unchanged.
    expect(result[0].totalAmount).toBe(100);
    expect(result[0].estimatedTotalAmount).toBe(119);
    expect(result[0].taxFeeAmount).toBe(5);
    expect(result[0].IVAFeeAmount).toBe(19);
    expect(result[0].coverageQuantity).toBe(0);
    expect(result[0].coverageTotalAmount).toBe(0);
    expect(result[0].returnFeeAmount).toBe(0);
    expect(result[0].extraHoursQuantity).toBe(0);
    expect(result[0].extraHoursTotalAmount).toBe(0);
    expect(result[0].referenceToken).toBe("tok-abc");
    expect(result[0].rateQualifier).toBe("RQ1");

    // The proxy was called with the resolved codes + datetimes.
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/localiza/availability");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(VALID_INPUT);
  });

  // Safe degradation: when getCategoryNameMap rejects, serve the RAW PT array.
  it("serves the raw proxy array (and logs) when getCategoryNameMap rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockRejectedValue(new Error("db down"));
    const { getCategoryCapacityMap } = await import(
      "@/lib/api/category-capacity"
    );
    vi.mocked(getCategoryCapacityMap).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const result = await searchAvailability(VALID_INPUT);

    expect(result).toEqual(PT_ITEMS);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Capacity enrichment degrades INDEPENDENTLY of name enrichment: when only the
  // capacity map rejects, the name-enriched array is still served, just without
  // the capacity fields. Proves the two enrichments don't share a failure path.
  it("serves name-enriched items WITHOUT capacity when getCategoryCapacityMap rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockResolvedValue(
      new Map([["C", "Gama C Económico Mecánico"]]),
    );
    const { getCategoryCapacityMap } = await import(
      "@/lib/api/category-capacity"
    );
    vi.mocked(getCategoryCapacityMap).mockRejectedValue(new Error("db down"));
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const result = (await searchAvailability(VALID_INPUT)) as Array<
      Record<string, unknown>
    >;

    // Name enrichment survived…
    expect(result[0].categoryDescription).toBe("Gama C Económico Mecánico");
    // …but capacity is simply absent (not zeroed).
    expect(result[0]).not.toHaveProperty("passengerCount");
    expect(result[0].totalAmount).toBe(100);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // SCEN-002 (service-side facet) — missing proxy config → ServiceError(500).
  it("throws ServiceError(500) when proxy config is missing", async () => {
    delete process.env.LOCALIZA_PROXY_URL;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { searchAvailability } = await import("@/lib/api/availability-service");
    await expect(searchAvailability(VALID_INPUT)).rejects.toMatchObject({
      status: 500,
    });
    errorSpy.mockRestore();
  });

  // SCEN-004 — Localiza business error propagated verbatim with proxy status.
  it("SCEN-004: forwards a parseable proxy business error as ServiceError(status, payload)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const envelope = {
      error: "localiza_business_error",
      message: "Mensaje ES",
      shortText: "LLNRAG009",
    };
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 422,
        text: () => JSON.stringify(envelope),
      }) as Response,
    );

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    await expect(searchAvailability(VALID_INPUT)).rejects.toMatchObject({
      status: 422,
      payload: envelope,
    });
    const err = await searchAvailability(VALID_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    errorSpy.mockRestore();
  });

  // Non-parseable proxy error → generic ServiceError(502).
  it("normalizes a non-JSON proxy error to ServiceError(502)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 500,
        text: () => "<html>Bad Gateway</html>",
      }) as Response,
    );

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await searchAvailability(VALID_INPUT).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(502);
    expect(typeof (err.payload as { error: string }).error).toBe("string");
    errorSpy.mockRestore();
  });

  // Network failure (fetch throws) → ServiceError(502).
  it("maps a fetch/network failure to ServiceError(502)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));

    const { searchAvailability } = await import("@/lib/api/availability-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await searchAvailability(VALID_INPUT).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(502);
    errorSpy.mockRestore();
  });
});
