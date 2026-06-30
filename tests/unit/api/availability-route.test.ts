import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Step 3 of issue #74: the public availability route composes the proxy passthrough
// with category-name enrichment under SAFE DEGRADATION. These tests exercise the
// REAL `enrichCategoryDescriptions` (only `getCategoryNameMap` is mocked) so the
// happy path proves the genuine wiring `enrich(data, await getCategoryNameMap())`,
// not a stubbed echo. The proxy is reached via global `fetch`, stubbed per-test.

vi.mock("@/lib/api/category-names", () => ({
  getCategoryNameMap: vi.fn(),
}));

// Keep the REAL NextResponse (tests rely on res.json()/res.status), but make
// `after` inert: outside a request scope it throws, and its search_logs callback
// (issue #206) is exercised by search-log.test.ts, not here.
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

// The route schedules logging via after() only on the success path (#206).
vi.mock("@/lib/api/search-log", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api/search-log")>();
  return { ...actual, logAvailabilitySearch: vi.fn() };
});

// PT input as Localiza returns it; categoryCode is the join key into the ES map.
const PT_ITEMS = [
  { categoryCode: "C", categoryDescription: "ECONÔMICO COM AR", price: 100 },
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

function makeRequest(body: unknown) {
  return {
    headers: { get: (k: string) => (k === "x-api-key" ? "test-key" : null) },
    json: async () => body,
  } as unknown as Request;
}

const VALID_BODY = {
  pickupLocation: "BOG01",
  returnLocation: "BOG01",
  pickupDateTime: "2026-07-01T10:00",
  returnDateTime: "2026-07-05T10:00",
};

describe("POST /api/reservations/availability — category enrichment (issue #74)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.RESERVATION_API_KEY = "test-key";
    process.env.LOCALIZA_PROXY_URL = "https://proxy.test";
    process.env.PROXY_API_KEY = "proxy-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // SCEN-008 — happy composition. Locks the REAL enrich wiring: the served
  // categoryDescription is the curated ES name from the map, NOT the PT input,
  // while passthrough fields (price) survive untouched. This is the ONLY test
  // that runs the real pure function, so it is the anti-gaming anchor proving
  // the route actually calls enrich(data, await getCategoryNameMap()).
  it("SCEN-008: replaces categoryDescription with the ES name and preserves passthrough fields", async () => {
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockResolvedValue(
      new Map([["C", "Gama C Económico Mecánico"]]),
    );
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );

    const { POST } = await import("@/app/api/reservations/availability/route");
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].categoryDescription).toBe("Gama C Económico Mecánico");
    // Passthrough untouched.
    expect(body[0].price).toBe(100);
  });

  // SCEN-003 — safe degradation. Locks the invariant that a lookup failure NEVER
  // breaks availability: when getCategoryNameMap rejects, the route serves the RAW
  // PT array (categoryDescription still in Portuguese) and logs the failure. A
  // naive implementation that let the rejection escape would 502 here.
  it("SCEN-003: serves the raw proxy array (and logs) when getCategoryNameMap rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockRejectedValue(new Error("db down"));
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );

    const { POST } = await import("@/app/api/reservations/availability/route");
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toEqual(PT_ITEMS);
    expect(body[0].categoryDescription).toBe("ECONÔMICO COM AR");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // SCEN-005a — structured proxy error forwarded verbatim. Asserts the PROXY
  // status (422) is preserved, NOT collapsed to 502, and the parsed business
  // envelope is returned so the Nuxt client renders the matching toast. The
  // explicit status assertion (not just body) is what makes this non-tautological.
  it("SCEN-005a: forwards a parseable proxy error with its own status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorEnvelope = {
      error: "localiza_business_error",
      message: "Mensaje ES",
      shortText: "LLNRAG009",
    };
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 422,
        text: () => JSON.stringify(errorEnvelope),
      }) as Response,
    );

    const { POST } = await import("@/app/api/reservations/availability/route");
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual(errorEnvelope);
    errorSpy.mockRestore();
  });

  // SCEN-005b — non-parseable proxy error falls back to the generic 502 envelope.
  // A network/HTML error page must NOT be forwarded as-is; the route normalizes
  // it to 502 + { error: <string> }. Asserting status 502 (distinct from the
  // proxy's 500) proves the fallback branch, not an accidental passthrough.
  it("SCEN-005b: normalizes a non-JSON proxy error to a 502 generic envelope", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 500,
        text: () => "<html>Bad Gateway</html>",
      }) as Response,
    );

    const { POST } = await import("@/app/api/reservations/availability/route");
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).toBeTruthy();
    // NOT the proxy body.
    expect(body).not.toHaveProperty("__html");
    errorSpy.mockRestore();
  });

  // SCEN-206-wiring-a — the route schedules search_logs logging on the success
  // path. Proves POST calls after() and forwards the served array + request body
  // to logAvailabilitySearch (the producer wiring, distinct from the producer's
  // own unit tests).
  it("SCEN-206a: schedules logging with the served array on a successful quote", async () => {
    const { getCategoryNameMap } = await import("@/lib/api/category-names");
    vi.mocked(getCategoryNameMap).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({ ok: true, status: 200, json: () => PT_ITEMS }) as Response,
    );
    const { after } = await import("next/server");
    const { logAvailabilitySearch } = await import("@/lib/api/search-log");

    const { POST } = await import("@/app/api/reservations/availability/route");
    await POST(makeRequest({ ...VALID_BODY, franchise: "alquilatucarro" }));

    // after() registers the deferred work; run the callback to assert the payload.
    expect(after).toHaveBeenCalledOnce();
    const deferred = vi.mocked(after).mock.calls[0][0] as () => unknown;
    await deferred();
    expect(logAvailabilitySearch).toHaveBeenCalledOnce();
    expect(vi.mocked(logAvailabilitySearch).mock.calls[0][0]).toMatchObject({
      franchise: "alquilatucarro",
      pickupLocation: "BOG01",
      availableCategories: PT_ITEMS,
    });
  });

  // SCEN-206-wiring-b — logging is success-only: a proxy error path must NOT
  // schedule any logging (errors are out of scope for v1).
  it("SCEN-206b: does NOT schedule logging when the proxy errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 500,
        text: () => "<html>Bad Gateway</html>",
      }) as Response,
    );
    const { after } = await import("next/server");

    const { POST } = await import("@/app/api/reservations/availability/route");
    await POST(makeRequest({ ...VALID_BODY, franchise: "alquilatucarro" }));

    expect(after).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
