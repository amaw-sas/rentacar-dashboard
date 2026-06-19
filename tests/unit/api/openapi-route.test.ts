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

  // SCEN-B: with no Host (the bundled fallback path), `servers` must be a single
  // absolute https URL with no template variables and never localhost — a
  // templated/localhost server makes Custom GPT Actions call the wrong origin.
  it("falls back to a concrete absolute https server with no template vars", async () => {
    const { GET } = await import("@/app/api/openapi/route");

    const res = await GET();
    const body = (await res.json()) as {
      servers: Array<{ url: string; variables?: unknown }>;
    };

    expect(body.servers).toHaveLength(1);
    expect(body.servers[0].url).toMatch(/^https:\/\//);
    expect(body.servers[0].url).not.toContain("localhost");
    expect(body.servers[0].url).not.toContain("{");
    expect(body.servers[0].variables).toBeUndefined();
  });

  // SCEN-A: each brand domain self-describes — the served `servers[0].url` is the
  // host that requested the doc, so a GPT importing from api.alquilame.co calls
  // back to api.alquilame.co, not the bundled canonical fallback.
  it("rewrites servers[0].url to the requesting host", async () => {
    const { GET } = await import("@/app/api/openapi/route");

    const res = await GET(
      new Request("https://api.alquilame.co/api/openapi", {
        headers: { host: "api.alquilame.co", "x-forwarded-proto": "https" },
      }),
    );
    const body = (await res.json()) as { servers: Array<{ url: string }> };

    expect(body.servers[0].url).toBe("https://api.alquilame.co");
  });

  it("answers OPTIONS preflight with 204 and CORS", async () => {
    const { OPTIONS } = await import("@/app/api/openapi/route");

    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
