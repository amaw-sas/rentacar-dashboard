# search_logs producer — design (issue #206)

## Problem

`search_logs` (migration 009) exists in prod but is **empty**. The migration comment
admits it: the `INSERT` was never wired. `app/api/reservations/availability/route.ts`
is a pure passthrough to the Localiza proxy — it quotes and returns, logging nothing.
The analytics tabs that read `search_logs` (`lib/queries/analytics.ts`) degrade to empty.

## Goal

Wire the producer in the availability route **without touching the quoting path**
(fire-and-forget) and **without breaking the funnels** (rentacar-web, rentacar-reservas,
which today send only 4 fields).

## Decision: dashboard-only, optional contract, skip without franchise

`search_logs.franchise` is `NOT NULL` with no default, but the availability route never
receives it — neither franchise, referral_code, session_id nor the monthly flag cross
into this route. The chosen path (Option A):

- Extend the request body with **optional** fields (`franchise`, `referralCode`,
  `sessionId`, `isMonthly`). Funnels that send only the original 4 fields keep working.
- When `franchise` is absent → **skip the INSERT** (no garbage in the key analytics
  dimension) and emit one debug line.
- Rows appear once the funnels are updated to send `franchise` — that funnel work is a
  **follow-up in other repos**, explicitly out of scope here.

Rejected alternatives: relaxing `franchise NOT NULL` (blinds the key dimension), or a
`'unknown'` sentinel (pollutes franchise). Both trade clean data for premature volume.

## Architecture

- New module `lib/api/search-log.ts`:
  - `buildSearchLogRow(input)` — **pure**: applies the franchise gate, splits the ISO
    datetimes into `date` + `hour` without `Date()` (no timezone shift), projects the
    row. Returns `null` when it must skip (no franchise / unparseable dates).
  - `logAvailabilitySearch(input)` — calls `buildSearchLogRow`; on a row, inserts via
    `createAdminClient()` (service-role; RLS has only an authenticated SELECT policy, no
    INSERT policy → service-role bypasses). Wrapped in try/catch end-to-end: **never
    throws**, so a logging failure cannot reach the response.
  - `searchLogContextSchema` (zod) — validates the optional context fields at the route
    boundary, per the project's Zod-at-the-boundary convention.
- `app/api/reservations/availability/route.ts`:
  - Parse the optional context with `searchLogContextSchema.safeParse(body)`.
  - On the **success path**, when the result is an array, schedule
    `after(() => logAvailabilitySearch(...))` and then return the response unchanged.

## Field mapping

| Column | Source |
|---|---|
| `franchise` | body.franchise (gate; skip when absent) |
| `pickup_location_code` / `return_location_code` | body locations |
| `pickup_date` / `pickup_hour` | literal ISO split of `pickupDateTime` |
| `return_date` / `return_hour` | literal ISO split of `returnDateTime` |
| `is_monthly` | body.isMonthly ?? false |
| `referral_code` | body.referralCode ?? null |
| `available_categories` | the result array verbatim (jsonb) |
| `total_results` | result array length |
| `selected_category_code` | null (post-search, out of scope) |
| `converted_to_reservation` | false (post-search) |
| `session_id` | body.sessionId ?? null |
| `user_agent` | `user-agent` header |
| `ip_address` | `x-forwarded-for` first hop / `x-real-ip` |

## Observable scenarios

1. **Given** a request with franchise and an array of N results, **when** POST
   availability, **then** the response is unchanged (200) **and** one row is written with
   that franchise, `total_results = N`, and the date/hour fields split correctly.
2. **Given** a request **without** franchise, **when** POST, **then** the response is
   normal **and** zero rows are written (debug "skip: no franchise").
3. **Given** the INSERT fails (DB down), **when** POST, **then** the quoting path still
   returns 200 — the failure is swallowed, never propagated.
4. **Given** an empty result array (0 available) with franchise, **when** POST, **then**
   one row with `total_results = 0` and `available_categories = []`.
5. **Given** a malformed datetime, **when** POST, **then** the response is normal **and**
   the insert is skipped (no corrupt row).

## Blast radius

- **Modified:** `app/api/reservations/availability/route.ts`.
- **New:** `lib/api/search-log.ts`, `tests/unit/api/search-log.test.ts`.
- **No migration** (table exists). **No funnel changes** (optional fields).
- **Consumers unchanged:** `lib/queries/analytics.ts`, both funnels.
- **Expected:** `search_logs` stays empty until the funnels send franchise (follow-up).

## Out of scope (follow-up)

- Funnel changes (rentacar-web, rentacar-reservas) to send the context fields.
- `selected_category_code` / `converted_to_reservation`: require linking search →
  reservation, a separate feature.
- Logging Localiza error responses (only successful array responses are logged in v1).
