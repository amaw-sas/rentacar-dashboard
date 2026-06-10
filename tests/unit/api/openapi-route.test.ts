import { describe, it, expect } from "vitest";

// SCEN-005 (deterministic half): the live spec endpoint serves the OpenAPI 3.0.3
// document with JSON content-type and CORS, and the body contains the directory
// path plus both reservation paths. The runtime no-key/middleware half is in
// Step 5's integration check.
describe("GET /api/openapi", () => {
  it("serves the OpenAPI 3.0.3 doc as JSON with CORS", async () => {
    const { GET } = await import("@/app/api/openapi/route");

    const res = await GET();

    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe("3.0.3");
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        "/api/locations",
        "/api/reservations",
        "/api/reservations/availability",
      ]),
    );
  });

  it("answers OPTIONS preflight with 204 and CORS", async () => {
    const { OPTIONS } = await import("@/app/api/openapi/route");

    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
