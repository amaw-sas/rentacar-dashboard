import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyApiKey } from "@/lib/api/mcp/auth";
import { PUBLIC_API_PREFIXES } from "@/middleware";

// Issue #72 Step 5: MCP auth (x-api-key, Phase 1) + middleware prefix.
// Holdout scenarios SCEN-105..107.

function reqWithKey(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set("x-api-key", key);
  return new Request("https://dash.test/api/mcp/mcp", { method: "POST", headers });
}

describe("verifyApiKey (issue #72 Step 5)", () => {
  const ORIGINAL = process.env.MCP_API_KEY;

  beforeEach(() => {
    process.env.MCP_API_KEY = "secret-mcp-key";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_API_KEY;
    else process.env.MCP_API_KEY = ORIGINAL;
  });

  // SCEN-105 — correct key → AuthInfo.
  it("SCEN-105: returns AuthInfo when x-api-key matches MCP_API_KEY", () => {
    const auth = verifyApiKey(reqWithKey("secret-mcp-key"));
    expect(auth).toBeDefined();
    expect(auth?.token).toBe("secret-mcp-key");
    expect(typeof auth?.clientId).toBe("string");
    expect(Array.isArray(auth?.scopes)).toBe(true);
  });

  // SCEN-106 — absent / wrong / no-key-configured → undefined (fail closed).
  it("SCEN-106: returns undefined when key is absent, wrong, or not configured", () => {
    expect(verifyApiKey(reqWithKey(undefined))).toBeUndefined();
    expect(verifyApiKey(reqWithKey(""))).toBeUndefined();
    expect(verifyApiKey(reqWithKey("wrong-key"))).toBeUndefined();

    delete process.env.MCP_API_KEY;
    expect(verifyApiKey(reqWithKey("secret-mcp-key"))).toBeUndefined();
  });
});

describe("middleware PUBLIC_API_PREFIXES (issue #72 Step 5)", () => {
  // SCEN-107 — /api/mcp bypasses session auth (listed) without disturbing the
  // existing prefixes (both funnels unchanged).
  it("SCEN-107: includes /api/mcp and preserves the existing prefixes", () => {
    expect(PUBLIC_API_PREFIXES).toContain("/api/mcp");
    for (const p of [
      "/api/reservations",
      "/api/cron",
      "/api/upload",
      "/api/locations",
      "/api/requirements",
      "/api/openapi",
    ]) {
      expect(PUBLIC_API_PREFIXES).toContain(p);
    }
  });

  // The anonymous chatbot route (V1) also bypasses session auth.
  it("includes /api/chat for the anonymous chatbot route", () => {
    expect(PUBLIC_API_PREFIXES).toContain("/api/chat");
  });
});
