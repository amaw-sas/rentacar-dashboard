---
name: reservations-server-pagination
created_by: claude
created_at: 2026-06-05T00:00:00Z
issue: 100
---

# Reservations list — server-side pagination, filtering, search

Root cause (measured, prod `ilhdholjrnbycyvejsub`, 13,003 reservations): `getReservations()`
fetches the entire table unbounded (~26 MB RSC payload) and ships it to a client-side
`@tanstack/react-table`. Every save navigates to `/reservations`, re-serializing and
re-hydrating all rows → 20s–2min. Fix: move pagination/filtering/search/sort to the server
so any visit transfers one page (≤20 rows).

The URL query contract is unchanged (`franchise, status, city, referral, created_from/to,
pickup_from/to, q, sort, page`) so shared links keep working.

## SCEN-001: default load returns one page, not the whole table
**Given**: 13,003 reservations exist and an operator opens `/reservations` with no query params
**When**: the page renders
**Then**: the server returns at most 20 reservation rows plus an exact total of 13,003; the
RSC payload carries ≤20 rows (NOT 13,003); the results label reads "13003 resultado(s)";
pagination shows page 1 of ceil(13003/20)
**Evidence**: row count in the `/reservations` RSC network payload ≤ 20; results-count label text; DB `count(*)`

## SCEN-002: saving an edit lands on the list quickly
**Given**: an operator edits a reservation field and clicks save
**When**: `updateReservation` succeeds and the form navigates to `/reservations`
**Then**: the list reflects the edited value on its row and renders transferring ≤20 rows
(no 26 MB payload); wall-clock to interactive is a few seconds, not tens of seconds
**Evidence**: rows in `/reservations` payload ≤ 20; edited value visible in the row cell; timing observation

## SCEN-003: status filter is applied server-side
**Given**: the operator selects status = `pendiente`
**When**: the URL becomes `?status=pendiente` and the server refetches
**Then**: every returned row has `status === "pendiente"`; the total equals
`SELECT count(*) FROM reservations WHERE status='pendiente'`
**Evidence**: status field of every returned row; results-count label vs independent SQL count

## SCEN-004: search spans the whole dataset, not just the loaded page
**Given**: a reservation whose `customer_name_at_booking` contains a distinctive term sits far
down the `created_at` order (well past page 1)
**When**: the operator types that term in the search box
**Then**: the reservation appears in the results — proving the match is computed server-side
over all 13k rows, not by filtering a page already in the browser
**Evidence**: the matching row is present in the returned page; results-count > 0

## SCEN-005: city filter returns only that city's pickups
**Given**: city X maps to pickup-location ids [a, b]
**When**: the operator selects city X (`?city=X`)
**Then**: every returned row has `pickup_location.city_id === X`; reservations whose
`pickup_location_id` is null/another city are excluded; total matches the SQL count
**Evidence**: `city_id` of every returned row; results-count vs SQL count

## SCEN-006: pagination advances server-side
**Given**: a filtered result set with total > 20 on page 1
**When**: the operator clicks "Siguiente"
**Then**: the URL becomes `?page=2`; the server returns the next ≤20 rows, disjoint from
page 1, continuing the same priority→created_at order
**Evidence**: row ids on page 2 differ from page 1; ordering is continuous across the boundary

## SCEN-007: created/pickup date ranges filter inclusively server-side
**Given**: `?created_from=2026-05-01&created_to=2026-05-31`
**When**: the server refetches
**Then**: every returned row has `created_at` within [2026-05-01 00:00, 2026-05-31 23:59:59]
inclusive; total matches the SQL count for that range
**Evidence**: `created_at` of every returned row; results-count vs SQL count

## SCEN-008: clearing filters restores default ordering and page 1
**Given**: several filters active while on page 5
**When**: the operator clicks the clear (eraser) button
**Then**: the URL is stripped of all managed keys; the list returns to priority→created_at
desc default, page 1, total 13,003
**Evidence**: URL has no managed query keys; results-count label reads 13003

## SCEN-009: combined filters AND together with a correct total
**Given**: `?franchise=alquilatucarro&status=reservado&q=<term>`
**When**: the server refetches
**Then**: every returned row satisfies all three conditions; the total equals the SQL count of
the conjunction; pagination is computed from that total
**Evidence**: each row's franchise+status+match; results-count vs SQL count of the conjunction

## SCEN-010: priority statuses float to page 1 across the whole dataset
**Given**: an old `pendiente` reservation (created months ago) and a recent `utilizado` one
**When**: the default-sorted first page renders
**Then**: the old `pendiente` row appears before the recent `utilizado` row, because priority
statuses (`pendiente, pendiente_modificar, mensualidad, pendiente_pago`) lead the order over
the entire table — not merely within a page
**Evidence**: relative row order on page 1

## SCEN-011: column sort applies server-side with a safe fallback
**Given**: `?sort=pickup_date:asc`
**When**: the server refetches
**Then**: rows are ordered by `pickup_date` ascending within priority groups; and a sort id
that maps to no real column (e.g. `referral`, `total_with_tax`) falls back to `created_at desc`
without erroring
**Evidence**: `pickup_date` ordering of returned rows; HTTP 200 (no PostgREST 400) for the derived sort id

## SCEN-012: search terms with PostgREST-reserved characters do not break the query
**Given**: the operator searches `O'BRIEN, JOSE` (apostrophe + comma + space)
**When**: the server builds the `or(ilike)` filter
**Then**: the request returns HTTP 200 (no PostgREST 400 from the comma splitting the filter
list) and yields matches for the sanitized term
**Evidence**: HTTP 200 from the query; returned rows (or an empty set), never a 400
