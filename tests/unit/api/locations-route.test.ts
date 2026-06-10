import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/location-directory", () => ({
  getLocationDirectory: vi.fn(),
}));

const ROWS = [
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
  {
    slug: "barranquilla-norte",
    code: "ACBAN",
    city: "barranquilla",
    name: "Barranquilla Norte",
    status: "active",
    pickup_address: "Vía 40 #76-63",
    pickup_map: "https://maps.app.goo.gl/y",
    schedule: { display: "Lun-Vie 08:00-16:00" },
  },
];

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

async function mockDirectory(impl: { rows?: typeof ROWS; reject?: Error }) {
  const { getLocationDirectory } = await import("@/lib/api/location-directory");
  if (impl.reject) {
    vi.mocked(getLocationDirectory).mockRejectedValue(impl.reject);
  } else {
    vi.mocked(getLocationDirectory).mockResolvedValue(impl.rows ?? ROWS);
  }
}

describe("GET /api/locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns the { count, locations } envelope with status 200", async () => {
    await mockDirectory({ rows: ROWS });
    const { GET } = await import("@/app/api/locations/route");

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 2, locations: ROWS });
  });

  it("sets the Cache-Control CDN TTL and the CORS wildcard origin", async () => {
    await mockDirectory({ rows: ROWS });
    const { GET } = await import("@/app/api/locations/route");

    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  // SCEN-007 at the route boundary: a query failure surfaces as 500, never an
  // unhandled throw, and still carries CORS so a browser client sees the error.
  it("returns 500 with an error envelope when the query throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await mockDirectory({ reject: new Error("connection refused") });
    const { GET } = await import("@/app/api/locations/route");

    const res = await GET();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    errorSpy.mockRestore();
  });

  it("answers OPTIONS preflight with 204 and CORS", async () => {
    const { OPTIONS } = await import("@/app/api/locations/route");

    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
