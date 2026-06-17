import { describe, it, expect } from "vitest";
import { GET, OPTIONS } from "@/app/api/requirements/route";
import { RENTAL_REQUIREMENTS } from "@/lib/api/rental-requirements";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

describe("GET /api/requirements", () => {
  it("returns the rental requirements with status 200", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(RENTAL_REQUIREMENTS);
  });

  it("sets the Cache-Control CDN TTL and the CORS wildcard origin", async () => {
    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  // Anchors the business-critical "turista extranjero" answer: a foreign license
  // requires a passport. If the source content drifts away from this rule, the
  // requirements endpoint stops answering the question it exists to answer.
  it("exposes the foreign-license rule (passport for foreign licenses)", async () => {
    const res = await GET();
    const body = (await res.json()) as typeof RENTAL_REQUIREMENTS;

    expect(body.reglaLicenciaConduccion.toLowerCase()).toContain("extranjera");
    expect(body.reglaLicenciaConduccion.toLowerCase()).toContain("pasaporte");
  });

  it("answers OPTIONS preflight with 204 and CORS", async () => {
    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
