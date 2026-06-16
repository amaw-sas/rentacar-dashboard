import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * MCP authentication — Phase 1: shared-secret `x-api-key` (issue #72).
 *
 * `withMcpAuth` calls this verifier per request; returning an `AuthInfo` means
 * authenticated, `undefined` means rejected (the SDK answers 401). We read the
 * `x-api-key` header directly (the repo's existing public-API convention), NOT a
 * Bearer token. Isolated here so Phase 2 can swap this for `verifyOAuthToken`
 * without touching the tools or the route wiring.
 *
 * `MCP_API_KEY` is a DISTINCT secret from `RESERVATION_API_KEY` (the public
 * funnels' key) — they are provisioned separately (plan Step 10 / rollout).
 */
export function verifyApiKey(req: Request): AuthInfo | undefined {
  const expected = process.env.MCP_API_KEY;
  // No key configured server-side → never authenticate (fail closed).
  if (!expected) return undefined;

  const provided = req.headers.get("x-api-key");
  if (!provided || provided !== expected) return undefined;

  // Minimal AuthInfo for a shared-secret client. `scopes` is empty in Phase 1
  // (no scope gating); `clientId` is a fixed label for logging/telemetry.
  return {
    token: provided,
    clientId: "mcp-shared-secret",
    scopes: [],
  };
}
