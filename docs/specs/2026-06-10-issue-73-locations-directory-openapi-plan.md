# Issue #73 — Implementation plan: public location directory + live OpenAPI

**Date:** 2026-06-10
**Branch:** `task/issue-73-locations-openapi`
**Design:** `docs/specs/2026-06-10-issue-73-locations-directory-openapi-design.md` (approved, spec-review passed)
**Holdout:** SCEN-001..007 from the design. Code satisfies them; they are never weakened to match output.

---

## File structure map

| File | New/Edit | Responsibility |
|---|---|---|
| `lib/api/location-directory.ts` | New | Exports `DIRECTORY_COLUMNS` (the single source-of-truth array of the 8 column names) and `getLocationDirectory()` — admin-client read of active locations, projection built from `DIRECTORY_COLUMNS`, `city→name` order. The only place that knows the catalog query. |
| `app/api/locations/route.ts` | New | Public `GET` transport: calls the query, wraps in `{ count, locations }`, sets Cache-Control + CORS, handles `OPTIONS`, maps query error → 500. Thin shell, no business logic. |
| `app/api/openapi/route.ts` | New | Public `GET` that serves the imported OpenAPI JSON with `application/json` + CORS. |
| `docs/apidog-rentacar-api.json` | Edit | +path `/api/locations` (`security: []`), +schemas `LocationDirectoryItem` / `LocationDirectoryResponse`, +`servers.description` update. |
| `middleware.ts` | Edit | Add `/api/locations` and `/api/openapi` to `PUBLIC_API_PREFIXES`. |
| `tests/unit/api/location-directory.test.ts` | New | Unit holdout: SCEN-001 (query-shape half) / 002 (active-filter call) / 006 (doc keys === `DIRECTORY_COLUMNS`) / 007 (throws). SCEN-001's runtime half (`count:31`, order) is Step 2, not here. |

No DB migration, no `db:types`. Reservation engine, notifications, and `rentacar-web` untouched.

## Prerequisites

- Worktree `.worktrees/issue-73-locations-openapi` on `task/issue-73-locations-openapi` (already created).
- Dev server with real env for runtime scenarios — Next does **not** autoload `.env.testing`; launch with
  `set -a && . ./.env.testing && set +a && pnpm dev` (project memory). Runtime checks (SCEN-003/004/005) need the real 31 prod/staging codes, not an empty preview branch (cold-pooler flake risk).
- No new dependencies.

## Implementation steps

Phases: **Foundation** (Step 1) → **Core** (Steps 2–4) → **Integration** (Step 5).

### Step 1 — Query layer `getLocationDirectory()` + `DIRECTORY_COLUMNS` — Size: S — Deps: none
`lib/api/location-directory.ts`:
- `export const DIRECTORY_COLUMNS = ["slug","code","city","name","status","pickup_address","pickup_map","schedule"] as const;` — the single source of truth for the projection. SCEN-006 (Step 3) and the `.select()` both consume it; no duplicated key list anywhere.
- `getLocationDirectory()`: `createAdminClient()`, `.select(DIRECTORY_COLUMNS.join(", ")).eq("status","active").order("city").order("name")`. Throws on Supabase error (caller maps it).

**Scenarios (embedded, unit — `tests/unit/api/location-directory.test.ts`, mocked admin client):**
- SCEN-001 (query-shape half): the `.select()` argument equals `DIRECTORY_COLUMNS.join(", ")`, and the **call chain** is asserted — `.eq("status","active")`, then `.order("city")` then `.order("name")` invoked in that sequence (spy on the query builder). Observable order over real data + `count: 31` is the **runtime half**, asserted in Step 2 — not here (asserting order on mock output would be tautological).
- SCEN-002: given the mock query builder, assert `.eq("status","active")` is invoked (the active filter is applied at the query layer). The exclusion of an inactive row is a consequence of that filter; we verify the filter call, not a fixture's pre-filtered output.
- SCEN-007: given the builder rejects/returns `{ error }`, the function throws (does not return a partial/empty success).
**Acceptance:** `pnpm test tests/unit/api/location-directory.test.ts` green; `DIRECTORY_COLUMNS` exported; `pnpm type-check` clean.

### Step 2 — `GET /api/locations` route + middleware prefix — Size: M — Deps: Step 1
`app/api/locations/route.ts`: `export const runtime = "nodejs"`, `export const dynamic = "force-dynamic"`. `GET` calls `getLocationDirectory()`, returns `{ count, locations }` with `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` and `Access-Control-Allow-Origin: *`; on thrown error → `500 { error }`. `OPTIONS` returns 204 with the CORS header. Edit `middleware.ts`: add `/api/locations` to `PUBLIC_API_PREFIXES`.
**Scenarios (embedded, runtime):**
- SCEN-003: `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/locations` with **no** `x-api-key` → `200`; `OPTIONS` returns 204 + CORS header.
- SCEN-001 (runtime half): the live response has `count: 31`, `locations.length === 31`, each item carries exactly the 8 `DIRECTORY_COLUMNS` fields, and the array is observably ordered by `city` then `name` (assert against the real prod/staging data — this is where `count: 31` and observable order are actually proven, not in the Step 1 mock).
**Acceptance:** runtime `200` + `count:31` + 8-field shape + observed order with no key; `Access-Control-Allow-Origin: *` present on GET and OPTIONS; `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` emitted on the response.
**Caching decision gate (the one real uncertainty — do not defer past this step):** confirm the `Cache-Control` header is emitted with `force-dynamic` under Next 16 by reading current Next docs + observing the localhost response header. If `force-dynamic` suppresses or strips it, apply the documented fallback (route-level `revalidate`, or `headers()` in `next.config`) and re-verify. localhost proves the header is *emitted*; a Vercel preview proves the CDN *honors* `s-maxage` — both required before this step is "done". `pnpm lint` + `type-check` clean.

### Step 3 — Extend OpenAPI document + drift guard — Size: M — Deps: Step 1 (`DIRECTORY_COLUMNS`)
Edit `docs/apidog-rentacar-api.json`: add `GET /api/locations` with `security: []`; add `LocationDirectoryItem` (the 8 fields, types matching the columns: `schedule` as object `{display: string}`) and `LocationDirectoryResponse` (`{count, locations[]}`); update `servers[0].description` from `"Admin API"` **and** `info.title` from `"Rentacar Admin API"` to reflect the now-public contract. Use a single consistent wording across both — `info.title = "Rentacar API"` and `servers[0].description = "Rentacar public + admin API"` (confirm the two agree at implementation, don't let them diverge).
Dep note: needs Step 1 only because SCEN-006 compares against the exported `DIRECTORY_COLUMNS` constant; the JSON edit itself has no code dependency, so it can proceed in parallel and only its test waits on Step 1.
**Scenario (embedded, unit):**
- SCEN-006: a test loads the JSON and asserts `Object.keys(LocationDirectoryItem.properties)` (as a set) === `new Set(DIRECTORY_COLUMNS)` imported from `lib/api/location-directory.ts` — one shared constant, so any drift between the `.select()` and the doc fails the test.
**Acceptance:** doc parses as valid OpenAPI 3.0.3 (JSON parse + structural assert, or `npx @redocly/cli lint`); SCEN-006 test green; `info.title` + `servers[0].description` updated.

### Step 4 — `GET /api/openapi` route + middleware prefix — Size: S — Deps: Step 3
`app/api/openapi/route.ts`: `GET` imports `@/docs/apidog-rentacar-api.json` (resolveJsonModule enabled — resolves at build time as a module) and returns it with `Content-Type: application/json` + `Access-Control-Allow-Origin: *`. **No `force-dynamic`** here: the JSON is a build-time bundled import with no env/network/per-request input, so a static/cacheable response is correct and `force-dynamic` would only add per-request cost for nothing (the "consistency" rationale in spec §3.3 is overridden by this evidence). Edit `middleware.ts`: add `/api/openapi` to `PUBLIC_API_PREFIXES`.
**Scenario (embedded, runtime):**
- SCEN-005: `GET localhost:3000/api/openapi` (no key) → 200, `Content-Type: application/json`, body parses as OpenAPI 3.0.3 and contains paths `/api/locations`, `/api/reservations`, `/api/reservations/availability`.
**Acceptance:** runtime 200 + parseable spec containing the three paths; `type-check` clean.

### Step 5 — End-to-end integration verification — Size: S — Deps: Steps 1–4
Run the dev server against real data and exercise the full discovery→resolution loop the issue requires.
**Scenarios (embedded, runtime integration):**
- SCEN-004: from a live `GET /api/locations`, feed **every one of the 31 returned `code` values** through `resolveLocationByCode(code)` (the exact resolver the reservation path uses — 31 cheap admin reads) and assert **all 31** resolve to an active row. Sampling one pair is insufficient for a 31-row catalog; iterating all 31 actually proves "directory codes are exactly the active codes availability/reservations accept" (spec §4 SCEN-004). Run against prod/staging data, never an empty branch.
- Re-confirm SCEN-003 + SCEN-005 on the running server together (both endpoints reachable, public, CORS present).
**Acceptance:** all 31 directory codes resolve via `resolveLocationByCode`; both endpoints serve unauthenticated; `/verification-before-completion` run with fresh evidence before any "done" claim, then `pnpm lint && type-check && test && build` all green.

## Testing strategy

- **Unit (Vitest, mocked admin client):** SCEN-001 (query-shape half: projection + call-chain order), SCEN-002 (active-filter call), SCEN-006 (doc keys === `DIRECTORY_COLUMNS`), SCEN-007 (throws on error) in `tests/unit/api/location-directory.test.ts` — mirrors existing `tests/unit/api/` (`resolve-references.test.ts`).
- **Runtime (dev server + curl, real data):** SCEN-001 (runtime half: `count:31` + 31 items + observable order), SCEN-003 (no-key 200 + OPTIONS/CORS + Cache-Control header), SCEN-004 (all 31 codes resolve), SCEN-005 (OpenAPI served + parses + contains the 3 paths).

**Scenario → step coverage (no orphans):** SCEN-001 → Step 1 (shape) + Step 2 (runtime count/order); SCEN-002 → Step 1; SCEN-003 → Step 2; SCEN-004 → Step 5; SCEN-005 → Step 4; SCEN-006 → Step 3; SCEN-007 → Step 1.
- **Gate:** CI sequence `type-check → lint → test → build` must pass (per stack rules). `/verification-before-completion` supplies fresh evidence before commit/PR.

## Rollout plan

- **Deploy:** additive only (2 new read-only public routes, 1 doc edit, 1 middleware edit). Normal Vercel deploy on PR merge.
- **Monitoring:** confirm on Vercel preview that `/api/locations` returns 200 with the Cache-Control header honored at the CDN (invisible on localhost); spot-check `/api/openapi`.
- **Rollback:** revert the PR. No DB change, no data mutation, no consumer depends on it yet (#72 is future) → zero-risk revert.

## Risk / uncertainty flags

- **Next 16 `force-dynamic` + manual `Cache-Control`** interaction is the one area to verify against current Next 16 docs at implementation time (training knowledge decays, per CLAUDE.md). If `force-dynamic` suppresses the header at the CDN, fall back to `revalidate`-based caching or `headers()` in `next.config`/route — decide with evidence, not assumption.
- **Dotted route avoided:** `/api/openapi` (not `/api/openapi.json`) sidesteps unverified Turbopack/matcher behavior.
