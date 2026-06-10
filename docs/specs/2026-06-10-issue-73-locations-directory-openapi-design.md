# Issue #73 — Public location directory + live OpenAPI

**Date:** 2026-06-10
**Branch:** `task/issue-73-locations-openapi`
**Status:** Design — pending spec review + user approval
**Unblocks:** #72 (MCP server) — this is the "broken link" the agentic audit flagged.
**Out of scope:** #74 (error normalization + PT→ES translation), web#28 (single-source-of-truth convergence).

---

## 1. Context

Issue #73 was authored from the `rentacar-web` repo without visibility into
`rentacar-dashboard`. Grounding against the real dashboard code reframes both
deliverables:

**Deliverable 1 — "OpenAPI/Swagger of the public contract" is ~80% already done.**
`docs/apidog-rentacar-api.json` is a valid OpenAPI 3.0.3 document that accurately
covers `POST /api/reservations/availability` and `POST /api/reservations` — verified
field-by-field against the route handlers. What it lacks: the location directory (which
does not exist yet) and a live, fetchable form. Error-message legibility is **#74's**
job, not this issue's.

**Deliverable 2 — the location directory is the real gap.** No public endpoint lists
locations. `getLocations()` / `getCities()` are RLS server-only queries (dashboard only).
`resolveLocationByCode("AABOT")` resolves a *single* code via the admin client, but
nothing lets a consumer **discover** the `slug ↔ code ↔ city` catalog. Without it, no
agent can build an availability query — that is the broken link.

**Architecture is settled by the epic and confirmed in data:** the dashboard is the
single chokepoint to Localiza and serves all 3 brands. Prod has **1 `rental_company`
(Localiza), 31 active locations, 31 distinct codes, zero collisions, every active row has
`slug` and `city` populated**. Locations hang off `rental_company_id`, not off a
franchise — so the directory is **brand-agnostic**. The `franchise` field only matters
when *creating* a reservation (which brand notifies), never for the catalog.

## 2. Goals / Non-goals

**Goals**
- Expose a stable public endpoint returning the canonical `slug ↔ code ↔ city` catalog of
  active locations, with enough presentation data (address, map, schedule) for an agent to
  render a result without a second call.
- Serve the OpenAPI contract live and fetchable, and extend it to document the new endpoint.
- Keep the dashboard the single source of truth for location data.

**Non-goals (YAGNI)**
- Authentication / API key on the directory. Decided open + no rate limit until there is
  evidence of abuse (a mis-tuned limit hurts legitimate agents more than it helps). The
  data is already public on the brand websites.
- Query parameters / server-side filtering. 31 rows is trivial; the consumer filters
  client-side.
- Touching `rentacar-web` or its `/api/rentacar-data` endpoint. The single-source-of-truth
  convergence (web reading from the dashboard) is web#28, a separate effort.
- Any DB migration or `db:types` regeneration — every column already exists.
- Error normalization / PT→ES translation of category descriptions — that is #74.
- A browsable Swagger UI page. Agents need the JSON; humans can import it into Apidog.

## 3. Design

### 3.1 Components

```
app/api/locations/route.ts        GET — public location directory (no key)
app/api/openapi.json/route.ts     GET — serves the OpenAPI spec live (no key)
lib/api/location-directory.ts     getLocationDirectory() — admin-client query
docs/apidog-rentacar-api.json     +path /api/locations, +directory schemas
middleware.ts                     +2 public prefixes
tests/unit/api/location-directory.test.ts
```

No DB change. Reservation engine and its documentation are untouched.

### 3.2 `GET /api/locations`

**Query layer** (`lib/api/location-directory.ts`):
`getLocationDirectory()` uses `createAdminClient()` (API-route-only, per the architecture
rule — the route is public and has no session, so RLS via cookies is unavailable). It
selects only the public fields, filters `status = 'active'`, and orders by `city` then
`name`. Returning the active filter at the query layer (not in the route) keeps the route
a thin transport shell.

**Response** — extensible envelope:

```json
{
  "count": 31,
  "locations": [
    {
      "slug": "armenia-aeropuerto",
      "code": "AARME",
      "city": "armenia",
      "name": "Armenia Aeropuerto",
      "status": "active",
      "pickup_address": "Aeropuerto el Edén – Local # 18, Km 14 Vía a la Tebaida",
      "pickup_map": "https://maps.app.goo.gl/yxKpFsswp4DKd6BL7",
      "schedule": { "display": "Lun-Vie 06:00-19:00 | Sáb, Dom y fest 08:00-16:00" }
    }
  ]
}
```

The envelope (vs. a raw array) leaves room for future metadata (`count`, eventual
versioning) without a breaking change. `schedule` is forwarded as the stored JSONB shape
(`{ display: string }`). The returned `code` is byte-for-byte what `availability` and
`reservations` accept — closing the `slug → code → reservation` loop.

`status` is always `"active"` today (the query filters to active). It is kept in the
payload for forward-compatibility, so a later opt-in to expose inactive locations does not
change the item shape.

**Caching:** `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`. Five
minutes balances cheap abuse protection against freshness — a location edit in the
dashboard propagates within ≤5 min, deliberately avoiding the 1-hour staleness that
`rentacar-web`'s Nitro cache imposes on fixes.

**Errors:** a Supabase failure returns `500 { "error": "<message>" }`. There is no 401
(the endpoint is public). Malformed requests are not possible — it is a parameterless GET.

### 3.3 `GET /api/openapi.json`

A route handler that imports `docs/apidog-rentacar-api.json`
(`resolveJsonModule` is already enabled) and returns it with
`Content-Type: application/json`. This gives the MCP server (#72) and any agent a stable,
fetchable contract to introspect at runtime, instead of a loose file in the repo.

### 3.4 OpenAPI extension (`docs/apidog-rentacar-api.json`)

- New path `GET /api/locations` with `security: []` (explicitly overriding the global
  `ApiKeyAuth` to mark it open).
- New component schemas `LocationDirectoryItem` and `LocationDirectoryResponse`, matching
  §3.2 exactly.
- The reservation paths and schemas are left unchanged.

### 3.5 Middleware

```ts
const PUBLIC_API_PREFIXES = [
  "/api/reservations", "/api/cron", "/api/upload",
  "/api/locations", "/api/openapi.json",
];
```

Both new prefixes bypass session auth. Neither route checks an `x-api-key`, so they are
genuinely open (the prefix bypass + no in-route key check = public).

## 4. Observable scenarios

These are the holdout set for `/scenario-driven-development`. Code satisfies them; they
are not weakened to match output.

- **SCEN-001 — Canonical catalog.** Given the 31 active locations in Supabase, when
  `GET /api/locations`, then 200 with `count: 31` and 31 items, each carrying the 8 fields
  of §3.2, ordered by `city` then `name`.
- **SCEN-002 — Active only.** Given a location with `status = 'inactive'`, when
  `GET /api/locations`, then that location is absent from the response.
- **SCEN-003 — No auth required.** Given no `x-api-key` header, when `GET /api/locations`,
  then 200 (never 401).
- **SCEN-004 — slug→code loop holds.** Given the directory response, then every `code`
  returned is one that `resolveLocationByCode` resolves to an active location today — i.e.
  the catalog's codes are exactly the codes the availability/reservation endpoints accept.
- **SCEN-005 — OpenAPI served live.** Given `GET /api/openapi.json`, then 200 with a valid
  OpenAPI 3.0.3 document that includes the `/api/locations` path and both reservation paths.
- **SCEN-006 — Spec matches reality.** Given the served spec, then the `LocationDirectoryItem`
  schema lists exactly the fields the endpoint returns (no drift between doc and handler).
- **SCEN-007 — Resilient on DB failure.** Given the Supabase query errors, when
  `GET /api/locations`, then 500 with `{ "error": ... }` and no unhandled throw.

## 5. Satisfaction strategy

- **SCEN-001/002/004/007** — unit tests on `getLocationDirectory()` with a mocked admin
  client (mirrors `tests/unit/` convention): assert field set, ordering, active filter,
  and error path. SCEN-004 cross-checks the returned codes against `resolveLocationByCode`'s
  query shape.
- **SCEN-003/005** — runtime validation against the dev server (per CLAUDE.md web-QA rule):
  `curl` both endpoints with no key, assert 200 and payload shape; validate the served doc
  parses as OpenAPI 3.0.3 and contains the expected paths.
- **SCEN-006** — a test that loads `docs/apidog-rentacar-api.json` and asserts the
  `LocationDirectoryItem` property set equals the keys the route emits, guarding against
  doc/handler drift.

## 6. Blast radius

- **New files:** `app/api/locations/route.ts`, `app/api/openapi.json/route.ts`,
  `lib/api/location-directory.ts`, `tests/unit/api/location-directory.test.ts`.
- **Edited:** `middleware.ts` (+2 prefixes), `docs/apidog-rentacar-api.json` (+path, +schemas).
- **Consumers:** MCP server #72 (future, unblocked by this). `rentacar-web` is **not**
  touched.
- **Database:** none. **Reservation flow / notifications:** untouched.
- **Risk:** the admin client (service role) is now reachable from a public, unauthenticated
  route. Mitigated because the query is read-only, scoped to a fixed column projection on a
  single table with a hard `status = 'active'` filter, takes no user input, and exposes only
  data already public on the brand websites.

## 7. Open defaults (vetoable in review)

- Response envelope `{ count, locations }` vs. raw array — chose envelope for extensibility.
- Cache `s-maxage=300` — chose 5 min over 0 or 1 h.

Both were surfaced and accepted during brainstorming.
