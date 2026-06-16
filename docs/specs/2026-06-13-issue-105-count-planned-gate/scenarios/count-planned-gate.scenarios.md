# Issue #105 — count:exact → planned gate (growth-gated)

Follow-up of #100. `getReservationsPage()` used `count: 'exact'`, which makes
PostgREST run a second full Seq Scan (`COUNT(*)` over the filtered set) on every
list render. At 13k rows that's ~7.6ms — noise next to the ~900ms render — but it
scales linearly and becomes the dominant DB cost past ~100k.

Decision (operator-approved): gate the count strategy on table size. Read the
planner's `reltuples` estimate (instant, no scan) and use an exact `COUNT(*)`
below 100k rows, PostgREST's planned count at/above it. Nothing changes at
today's scale; the optimization auto-activates when the table grows.

Trade-off accepted: at scale the header total and page count become approximate,
and narrow filtered searches inherit the planner's weaker estimates for `ilike`
filters. The header renders `~N` to signal this.

## Scenarios

### SCEN-105-1 — Below threshold keeps exact totals (today, 13k rows)
- **Given** the planner estimates the reservations table at fewer than 100,000 rows
- **When** the list renders
- **Then** the page query selects with `{ count: "exact" }`
- **And** the result is `approximate: false`
- **And** the header shows the exact count with no `~` prefix
- *Observable: zero behavior change from before #105 at current scale.*

### SCEN-105-2 — At/above threshold, the UNFILTERED list switches to planned (≥100k rows)
- **Given** the planner estimates the table at 100,000 rows or more
- **And** no narrowing filter or search is applied (the default fast path)
- **When** the list renders
- **Then** the page query selects with `{ count: "planned" }`
- **And** the render no longer issues a second full `COUNT(*)` Seq Scan
      (verified via EXPLAIN: the planned count is a planner estimate, not a scan)
- **And** the result is `approximate: true`
- **And** the header shows `~N resultado(s)` and pagination remains navigable

### SCEN-105-5 — Filtered/searched queries stay exact even at scale (pagination reachability)
- **Given** the table is at/above 100,000 rows
- **And** any narrowing filter or search is applied
      (franchise, status, referral, city, created/pickup range, channel, or search)
- **When** the list renders
- **Then** the page query selects with `{ count: "exact" }` — never `planned`
- **And** the result is `approximate: false`
- *Why: `count: "planned"` returns the planner's estimate for the FILTERED query,
  which is routinely wrong for selective predicates. An undercount makes rows past
  the estimated last page unreachable; an overcount yields phantom empty pages. The
  filtered result set is small, so an exact `COUNT(*)` is cheap and must stay exact
  for pagination to be correct. Only the unfiltered "browse all" path — where the
  planned count ≈ whole-table reltuples and is accurate — uses planned.*

### SCEN-105-3 — The size probe is cheap and resilient
- **Given** the list renders repeatedly
- **Then** the size estimate comes from `reltuples` (planner statistic), never a `COUNT(*)`
- **And** the estimate is cached so it does not add an RPC round-trip to every render
- **And** if the estimate RPC fails, the list falls back to `count: "exact"`
      and still renders (the probe can never break the list)
- **And** a never-analyzed table (`reltuples = -1`) or a malformed/non-finite
      estimate folds to `0 → count: "exact"`, never a negative or NaN gate input

### SCEN-105-4 — Threshold boundary
- **Given** the estimate is exactly 100,000 → uses `planned` (`>=`)
- **Given** the estimate is 99,999 → uses `exact`

## Satisfaction criteria (from the issue)
1. At target scale the list render no longer includes a `COUNT(*)` full Seq Scan — **SCEN-105-2**.
2. The page count stays usable for navigation under the approximate total — **SCEN-105-2**.
3. Product decision on showing the total as approximate — resolved: render `~N` only on the planned path — **SCEN-105-1 / -2**.
