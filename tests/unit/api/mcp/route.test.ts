import { describe, it, expect, beforeAll, afterAll } from "vitest";

// WS3 (issue #172): end-to-end evidence for SCEN-W1 through the REAL route wiring.
// Importing the route builds the actual mcp-handler; the empty-body probe is
// answered by our wrapper BEFORE the SDK, so it needs no network. The quote
// secret is set because tools.ts fails closed without a strong one at import-time
// usage (buscarDisponibilidad), though the probe path never reaches it.

const STRONG_SECRET = "test-quote-secret-0123456789abcdef";
let original: string | undefined;
beforeAll(() => {
  original = process.env.MCP_QUOTE_SECRET;
  process.env.MCP_QUOTE_SECRET = STRONG_SECRET;
});
afterAll(() => {
  if (original === undefined) delete process.env.MCP_QUOTE_SECRET;
  else process.env.MCP_QUOTE_SECRET = original;
});

// Importing the route module builds the real mcp-handler, which is heavier than
// a unit test; under full-suite parallel contention it can exceed the 5s default.
// A generous timeout keeps this integration check reliable in CI without masking
// a genuine hang.
const ROUTE_IMPORT_TIMEOUT_MS = 30_000;

describe("MCP route handler — ChatGPT connector readiness", () => {
  // SCEN-W1 — the live probe that currently 406s in prod must be 200 here.
  it(
    "SCEN-W1: empty-body POST probe → 200 {ok:true} via the real route",
    async () => {
      const { POST } = await import("@/app/api/mcp/[transport]/route");
      const res = await POST(
        new Request("https://x/api/mcp/mcp", {
          method: "POST",
          headers: {
            accept: "*/*",
            "content-type": "application/octet-stream",
          },
          body: "",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    },
    ROUTE_IMPORT_TIMEOUT_MS,
  );

  it(
    "exports GET and POST as functions",
    async () => {
      const mod = await import("@/app/api/mcp/[transport]/route");
      expect(typeof mod.GET).toBe("function");
      expect(typeof mod.POST).toBe("function");
    },
    ROUTE_IMPORT_TIMEOUT_MS,
  );
});
