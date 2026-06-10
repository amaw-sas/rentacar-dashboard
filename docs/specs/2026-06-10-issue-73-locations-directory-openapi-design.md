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
app/api/openapi/route.ts          GET — serves the OpenAPI spec live (no key)
lib/api/location-directory.ts     getLocationDirectory() — admin-client query
docs/apidog-rentacar-api.json     +path /api/locations, +directory schemas
middleware.ts                     +2 public prefixes
tests/unit/api/location-directory.test.ts
```

The OpenAPI route serves at **`/api/openapi`** (plain segment), not `/api/openapi.json`.
A dotted route-segment folder is legal in App Router but is an unusual pattern this repo
has never used, and its interaction with Turbopack resolution and the middleware
static-asset matcher is unverified; the `.json` suffix buys nothing for a consumer that
reads `Content-Type`. Avoided rather than risked.

No DB change. Reservation engine and its documentation are untouched.

### 3.2 `GET /api/locations`

**Query layer** (`lib/api/location-directory.ts`):
`getLocationDirectory()` uses `createAdminClient()` (API-route-only, per the architecture
rule — the route is public and has no session, so RLS via cookies is unavailable). The
exact projection (verified against prod — these are the real `locations` column names, so
no rename mapping is needed):

```ts
supabase
  .from("locations")
  .select("slug, code, city, name, status, pickup_address, pickup_map, schedule")
  .eq("status", "active")
  .order("city")
  .order("name");
```

Filtering `status = 'active'` at the query layer (not in the route) keeps the route a thin
transport shell. The payload keys are byte-identical to these 8 columns — SCEN-006's
doc-vs-handler parity check has this list as its concrete target.

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

**Runtime + caching (Next 16 — verify against docs during planning, per CLAUDE.md):**
- `export const runtime = "nodejs"` — `createAdminClient()` reads `SUPABASE_SERVICE_ROLE_KEY`
  and uses the node Supabase client; it cannot run on edge.
- `export const dynamic = "force-dynamic"` — prevents Next from trying to evaluate the
  route at build time (env + network unavailable then) and from baking a stale full-route
  cache. The route runs per-request; CDN-level caching is governed solely by the explicit
  header below.
- Response header: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`. Five
  minutes trims redundant CDN-origin hits while keeping edits fresh — a location change in
  the dashboard propagates within ≤5 min, deliberately avoiding the 1-hour staleness that
  `rentacar-web`'s Nitro cache imposes on fixes. (This is a CDN TTL, not a rate limit; it
  does not bound a query-string-varying or cache-cold attacker — consistent with the
  explicit no-rate-limit decision.)

The exact interaction of `force-dynamic` + a manual `Cache-Control` header under Next 16 /
Turbopack must be confirmed against current Next docs at implementation time (training
knowledge decays). SCEN-005 and the runtime QA assert the observed `Cache-Control` header
on a real response.

**CORS:** both new routes set `Access-Control-Allow-Origin: *` and answer `OPTIONS`
(preflight) with the same. The stated use case includes browser-side / cross-origin agent
fetch (e.g. ChatGPT-style connectors), which is blocked without it; the data is already
public, so a wildcard origin leaks nothing. No existing `app/api/` route sets CORS today —
this is deliberately new surface, scoped to these two read-only public endpoints only.

**Errors:** a Supabase failure returns `500 { "error": "<message>" }`. There is no 401
(the endpoint is public). Malformed requests are not possible — it is a parameterless GET.

### 3.3 `GET /api/openapi`

A route handler that imports `docs/apidog-rentacar-api.json`
(`resolveJsonModule` is already enabled) and returns it with
`Content-Type: application/json` and `Access-Control-Allow-Origin: *`. This gives the MCP
server (#72) and any agent a stable, fetchable contract to introspect at runtime, instead
of a loose file in the repo. Same runtime/caching directives as §3.2 (`runtime="nodejs"`
is not strictly required here since it only reads a bundled JSON, but `force-dynamic` +
the `Cache-Control` header apply identically for consistency).

### 3.4 OpenAPI extension (`docs/apidog-rentacar-api.json`)

- New path `GET /api/locations` with `security: []` (explicitly overriding the global
  `ApiKeyAuth` to mark it open).
- New component schemas `LocationDirectoryItem` and `LocationDirectoryResponse`, matching
  §3.2's 8-field projection exactly.
- Update the `servers` block `description` from `"Admin API"` to reflect that it now also
  carries the public directory contract (e.g. `"Rentacar public + admin API"`); the URL
  list (`localhost:3000`, `rentacar-dashboard.vercel.app`) stays correct. Optionally add a
  short note that `/api/locations` and `/api/openapi` are the unauthenticated paths.
- The reservation paths and schemas are left unchanged.

### 3.5 Middleware

```ts
const PUBLIC_API_PREFIXES = [
  "/api/reservations", "/api/cron", "/api/upload",
  "/api/locations", "/api/openapi",
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
- **SCEN-002 — Active only.** Given a test fixture containing one `status = 'inactive'`
  location among active ones, when `getLocationDirectory()` runs, then the inactive row is
  absent from the result. (Verified via mock — prod has no inactive row to observe.)
- **SCEN-003 — No auth required.** Given no `x-api-key` header, when `GET /api/locations`,
  then 200 (never 401).
- **SCEN-004 — slug→code loop holds (runtime).** Given a live `GET /api/locations` against
  the real DB, when one returned `(slug, code)` pair is fed to the reservation path's code
  resolution, then `resolveLocationByCode(code)` returns a row — i.e. the catalog's codes
  are exactly the active codes the availability/reservation endpoints accept. This is a
  runtime/integration check against the real 31 codes, **not** a mocked unit test (a mock
  would be circular and prove nothing).
- **SCEN-005 — OpenAPI served live.** Given `GET /api/openapi`, then 200 with
  `Content-Type: application/json` and a body that parses as OpenAPI 3.0.3 and includes the
  `/api/locations` path and both reservation paths.
- **SCEN-006 — Spec matches reality.** Given the served spec, then the `LocationDirectoryItem`
  schema lists exactly the fields the endpoint returns (no drift between doc and handler).
- **SCEN-007 — Resilient on DB failure.** Given the Supabase query errors, when
  `GET /api/locations`, then 500 with `{ "error": ... }` and no unhandled throw.

## 5. Satisfaction strategy

- **SCEN-001/002/007** — unit tests on `getLocationDirectory()` with a mocked admin client
  (mirrors `tests/unit/api/` convention — dir already exists with
  `resolve-references.test.ts`): assert the 8-field projection, `city`→`name` ordering, the
  active filter, and the error path.
- **SCEN-003/004/005** — runtime validation against the dev server (per CLAUDE.md web-QA
  rule): `curl` both endpoints with no key, assert 200, observed `Cache-Control` and CORS
  headers, and payload shape; feed one real `(slug, code)` pair through code resolution
  (SCEN-004); validate the served doc parses as OpenAPI 3.0.3 and contains the expected
  paths.
- **SCEN-006** — a unit test that loads `docs/apidog-rentacar-api.json` and asserts the
  `LocationDirectoryItem` property set equals the 8-column projection in §3.2, guarding
  against doc/handler drift.

**QA execution notes (from spec review):**
- The `Cache-Control: s-maxage` directive is a CDN behavior and is **invisible on
  `localhost`**. Observe it on a Vercel preview deployment to confirm the header is emitted
  as written; the local `curl` only confirms the header value, not CDN honoring.
- SCEN-004's runtime check must run against **prod or staging data** (the real 31 codes),
  never an empty Supabase preview branch — a cold-pooler timeout there would be a
  flake, not a logic failure (see the branch-pooler cold-start note in project memory).

## 6. Blast radius

- **New files:** `app/api/locations/route.ts`, `app/api/openapi/route.ts`,
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
