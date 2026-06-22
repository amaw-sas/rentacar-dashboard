import { describe, it, expect } from "vitest";
import { PUBLIC_API_PREFIXES } from "@/middleware";

// Issue #72 Step 5 / issue #172: /api/mcp must bypass Supabase session auth.
// Since issue #172 the endpoint is ANONYMOUS (no x-api-key, no OAuth) — being a
// public prefix is what lets an unauthenticated AI client reach it. Holdout
// scenario SCEN-107 (relocated from the deleted auth.test.ts).

describe("middleware PUBLIC_API_PREFIXES (issue #72 Step 5 / #172)", () => {
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
});
