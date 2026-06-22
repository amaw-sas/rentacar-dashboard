---
name: anonymous-signed-quote
created_by: orchestrator
created_at: 2026-06-22T00:00:00Z
---

# Holdout — Issue #172: anonymous MCP endpoint + signed/expiring quote

Issue #172 drops OAuth and `x-api-key` from the MCP reservation server (`/api/mcp`).
End customers connect by URL, anonymously. The anti-abuse model moves into the quote
itself plus platform rate-limiting:

- The quote is **HMAC-SHA256 signed** (`MCP_QUOTE_SECRET`) over the payload, so a
  client cannot forge a price.
- The quote **expires** (`iat`/`exp`, default TTL 1800s), so a stale quote cannot be
  replayed.
- The secret must be **strong** (trimmed, >= 32 chars) and the server **fails closed**
  if it is missing/weak — the secret is the only anti-tamper control on an anonymous
  endpoint.
- Vercel Firewall rate-limits the endpoint at the platform level (out of code).
- Reservations enter status `nueva` for operator review.

These scenarios are the write-once holdout. Each is encoded as a test before/with the
code (SDD Iron Law). Files: `lib/api/mcp/quote.ts`, `lib/api/mcp/tools.ts`,
`app/api/mcp/[transport]/route.ts`, `middleware.ts`.

The `/api/reservations*` contract (both public funnels) is unchanged.

---

## Quote codec — signing + expiry (`lib/api/mcp/quote.ts`)

### SCEN-101: deterministic round-trip
**Given**: a valid `QuoteContext` and a fixed `issuedAtMs`
**When**: `decodeQuote(encodeQuote(ctx, { issuedAtMs }), { nowMs })` with `nowMs` inside the TTL
**Then**: the result deep-equals `ctx` (no `iat`/`exp`/`sig` leak) AND re-encoding the same
ctx with the same `issuedAtMs` yields a byte-identical blob
**Evidence**: vitest `tests/unit/api/mcp/quote.test.ts` SCEN-101 — `toEqual(VALID_CTX)` + `toBe(blob)`

### SCEN-102: absent/empty blob rejected
**Given**: `""`, `undefined`, or `null` passed to `decodeQuote`
**When**: decoded
**Then**: throws the Spanish `INVALID_QUOTE_MESSAGE`
**Evidence**: vitest SCEN-102 — `toThrow(/cotización/i)`

### SCEN-103: corrupt base64/JSON/wire-format rejected, no leak
**Given**: a non-2-part blob, non-base64 garbage, or base64 of non-JSON
**When**: decoded
**Then**: throws `INVALID_QUOTE_MESSAGE`; the message never contains a JSON/zod/stack/hmac dump
**Evidence**: vitest SCEN-103 — `toMatch(/inválida o expiró/i)` + `not.toMatch(/JSON|SyntaxError|zod|hmac/i)`

### SCEN-104: incomplete/altered shape rejected
**Given**: a correctly-signed payload missing `referenceToken`, with `selected_days: 0`, or a
string `total_price`
**When**: decoded
**Then**: throws `INVALID_QUOTE_MESSAGE` (zod shape check)
**Evidence**: vitest SCEN-104

### SCEN-130: tampered signed payload rejected
**Given**: a valid signed quote whose payload segment is mutated (re-priced or one char flipped)
WITHOUT re-signing
**When**: decoded
**Then**: the HMAC no longer matches → throws `INVALID_QUOTE_MESSAGE`
**Evidence**: vitest SCEN-130; red-green: disabling the signature check makes this FAIL

### SCEN-131: expiry boundary — `exp` is exclusive
**Given**: a quote with `exp = iat + ttl*1000`
**When**: decoded at `nowMs === exp` (and at `nowMs === exp - 1`)
**Then**: at `exp` it is REJECTED (the clock has reached expiry); at `exp - 1` it is still valid
**Evidence**: vitest SCEN-131; red-green: disabling the expiry check makes this FAIL

### SCEN-132: wrong-secret signature rejected
**Given**: a quote signed with a different secret than `MCP_QUOTE_SECRET`
**When**: decoded
**Then**: throws `INVALID_QUOTE_MESSAGE`
**Evidence**: vitest SCEN-132; red-green: disabling the signature check makes this FAIL

### SCEN-133: valid non-expired quote round-trips
**Given**: a correctly-signed, non-expired quote
**When**: decoded inside the TTL
**Then**: deep-equals the ctx (positive control)
**Evidence**: vitest SCEN-133

### SCEN-134: fail closed on missing/empty secret
**Given**: `MCP_QUOTE_SECRET` unset or `""`
**When**: `encodeQuote(ctx)` / `decodeQuote(blob)`
**Then**: encode throws a clear internal error (`/MCP_QUOTE_SECRET/`); decode throws the Spanish
`INVALID_QUOTE_MESSAGE` (never the internal error)
**Evidence**: vitest SCEN-134

### SCEN-135: fail closed on weak secret (whitespace-only / too short)
**Given**: `MCP_QUOTE_SECRET` set to `"   "` (whitespace only) or to a non-blank value shorter
than 32 chars after trimming
**When**: `encodeQuote(ctx)` / `decodeQuote(blob)` / `assertQuoteSecretConfigured()`
**Then**: encode + assert throw the internal error (`/MCP_QUOTE_SECRET/`); decode throws the
Spanish `INVALID_QUOTE_MESSAGE`. A trivially-guessable key never signs a quote on an anonymous
endpoint.
**Evidence**: vitest SCEN-135

---

## Tool 1 — config error is not masked as empty availability (`lib/api/mcp/tools.ts`)

### SCEN-136: missing secret surfaces as a real error, not fake "no availability"
**Given**: `MCP_QUOTE_SECRET` unset (or weak) and a resolvable city with real availability
**When**: `buscar_disponibilidad` runs
**Then**: it does NOT return a generic "no hay disponibilidad / intenta más tarde" result; it
throws (propagates a configuration error) BEFORE the per-category loop, so the misconfiguration is
distinguishable from a data glitch. Genuinely malformed individual items are still skipped (per-item
degradation preserved).
**Evidence**: vitest `tests/unit/api/mcp/tools.test.ts` SCEN-136 — `await expect(buscar(...)).rejects.toThrow(/MCP_QUOTE_SECRET/)`; and the existing malformed-item skip test (SCEN-123) still passes with a configured secret

---

## Endpoint — anonymous (`app/api/mcp/[transport]/route.ts`, `middleware.ts`)

### SCEN-107: `/api/mcp` bypasses session auth (public prefix)
**Given**: the middleware `PUBLIC_API_PREFIXES`
**When**: inspected
**Then**: contains `/api/mcp` (so an unauthenticated AI client reaches the tools) alongside the
existing prefixes (both funnels unchanged)
**Evidence**: vitest `tests/unit/api/mcp/middleware-prefix.test.ts` SCEN-107

### SCEN-140 (code/comment invariant): no OAuth, no x-api-key in the route
**Given**: the route module
**When**: read
**Then**: exports the bare `handler` as GET and POST (no `withMcpAuth`, no `verifyApiKey`); the
issue-#99 timeout/maxDuration comments are intact
**Evidence**: `git grep` finds no `withMcpAuth`/`verifyApiKey`/`MCP_API_KEY` in code (docs/specs are
historical); route file exports `{ handler as GET, handler as POST }`
