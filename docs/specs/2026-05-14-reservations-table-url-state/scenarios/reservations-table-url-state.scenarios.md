---
name: reservations-table-url-state
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-14T20:00:00Z
spec: docs/specs/2026-05-14-reservations-table-url-state-design.md
issue: 27
epic: 29
---

# Scenarios — Reservations table URL state preservation

Holdout contract for issue #27. Write-once after first commit.
Mirrors the "Observable scenarios" section of the design spec.

The hook `useReservationsTableUrlState` owns `FilterState`, `ALL`, `PRIORITY_SORT`, `DEFAULT_USER_SORT`, and `INITIAL_FILTERS`. Tests mock `next/navigation` the same way the #28 hook tests do.

---

## SCEN-001: pasted URL hydrates filters + searchInput

**Given**: a fresh tab navigates to `/reservations?franchise=alquilatucarro&status=pendiente&city=<uuid>&q=lopez`.
**When**: the hook mounts.
**Then**: `filters.franchise === "alquilatucarro"`, `filters.status === "pendiente"`, `filters.city === "<uuid>"`, `filters.search === "lopez"`, AND the locally-buffered `searchInput === "lopez"`.
**Evidence**: vitest renders `useReservationsTableUrlState()` with mocked `useSearchParams` returning the query above; reads `result.current.filters` and `result.current.searchInput`. Asserts every key.

---

## SCEN-002: sentinel ALL omits the key from URL

**Given**: the hook is mounted on `/reservations?franchise=alquilatucarro`.
**When**: the operator calls `setFilter("franchise", ALL)`.
**Then**: `router.replace` is invoked with a URL that has NO `franchise` key (the sentinel is the "no filter" state and must not appear in URLs).
**Evidence**: vitest acts `setFilter("franchise", ALL)`, reads the last `replaceMock` call, parses the URL with `URLSearchParams`, asserts `params.has("franchise") === false`.

---

## SCEN-003: DateRange round-trip across DST and leap years

**Given**: `setFilter("createdRange", { from: new Date(2026, 4, 1), to: new Date(2026, 4, 31) })` is called (May 1 → May 31 2026 in local TZ).
**When**: `router.replace` fires and a fresh mount re-parses the URL.
**Then**: `filters.createdRange.from.getFullYear() === 2026`, `getMonth() === 4`, `getDate() === 1`. Same checks for `.to` with `getDate() === 31`. The serialization round-trip preserves the exact local-TZ wall-clock date — verified explicitly for Feb 29 in a leap year and for a date crossing a DST boundary.
**Evidence**: vitest acts the setFilter call, captures the URL `replaceMock` was called with, swaps mocked `useSearchParams` to that URL, re-renders the hook, asserts the resulting `filters.createdRange` matches the input by component (Y/M/D triplet). Additional cases: `{from: 2024-02-29, to: 2024-03-01}` and a DST-spanning range in `America/Bogota` (no DST — should still pass) plus `America/New_York` if testable.

---

## SCEN-004: partial DateRange hydrates with `to` undefined

**Given**: a URL `/reservations?created_from=2026-05-01` (no `created_to`).
**When**: the hook hydrates.
**Then**: `filters.createdRange.from` is a Date at May 1, 2026 local TZ; `filters.createdRange.to === undefined`. The filter logic `isWithinDateRange` returns true for all rows (no-op when `to` is missing).
**Evidence**: vitest sets the URL, mounts the hook, asserts `filters.createdRange.from` exists and `filters.createdRange.to === undefined`.

---

## SCEN-005: PRIORITY_SORT is never serialized to URL

**Given**: `onSortingChange` receives `[PRIORITY_SORT, { id: "pickup_date", desc: false }]` (the canonical input from the consumer after a header click).
**When**: writeUrl fires.
**Then**: the resulting URL has `?sort=pickup_date:asc` — no segment containing `priority`. The PRIORITY_SORT entry is stripped before serialization.
**Evidence**: vitest acts `onSortingChange(...)`, captures the URL, asserts `params.get("sort") === "pickup_date:asc"` and asserts `url` does not contain the substring `priority`.

---

## SCEN-006: URL sort hydrates with PRIORITY_SORT re-prepended

**Given**: a URL `/reservations?sort=pickup_date:asc`.
**When**: the hook hydrates.
**Then**: `sorting === [PRIORITY_SORT, { id: "pickup_date", desc: false }]` — PRIORITY_SORT at index 0 followed by the URL-derived user sort.
**Evidence**: vitest sets URL, mounts hook, asserts `sorting[0].id === "priority"` and `sorting[1] === { id: "pickup_date", desc: false }`.

---

## SCEN-006b: default-sort fallback when URL has no `sort` key

**Given**: a URL `/reservations` with no `sort` key.
**When**: the hook hydrates.
**Then**: `sorting === [PRIORITY_SORT, { id: "created_at", desc: true }]` — PRIORITY_SORT + the DEFAULT_USER_SORT constant. AND serializing this exact state back to URL drops the `sort` key (no redundant defaults).
**Evidence**: vitest mounts hook with empty URL, asserts `sorting`. Then acts `onSortingChange(sorting)` (same state), asserts `replaceMock` was either not called (no-op skip) or called with a URL that has no `sort` key.

---

## SCEN-007: any filter or sort change resets page to 1

**Given**: the operator is on `/reservations?page=3&status=pendiente`.
**When**: they call `setFilter("city", "<uuid>")` (any filter change).
**Then**: the resulting URL has `city=<uuid>`, retains `status=pendiente`, and has NO `page` key.
**Evidence**: vitest sets URL, acts setFilter, asserts `params.has("page") === false` AND `params.get("city") === "<uuid>"` AND `params.get("status") === "pendiente"`. Repeats for `onSortingChange` with a non-default sort: page also drops.

---

## SCEN-008: page change preserves filters and sort

**Given**: the operator is on `/reservations?status=pendiente&sort=pickup_date:asc`.
**When**: `onPaginationChange({ pageIndex: 1, pageSize: 20 })` fires (advance to page 2).
**Then**: the URL becomes `/reservations?status=pendiente&sort=pickup_date:asc&page=2`. Filters and sort survive.
**Evidence**: vitest asserts all three keys in the captured URL.

---

## SCEN-009: search debounce coalesces rapid typing into one router.replace

**Given**: the hook is mounted with `vi.useFakeTimers()`.
**When**: `setFilter("search", "l")`, then `"lo"`, then `"lop"`, then `"lope"`, then `"lopez"` are called with 100 ms `vi.advanceTimersByTime` between each, then a final 250 ms advance.
**Then**: `replaceMock` has been called **exactly once**, with a URL whose `q` equals `"lopez"`. AND `searchInput === "lopez"` synchronously after each keystroke (no DOM blanking).
**Evidence**: vitest with fake timers, intermediate `expect(replaceMock).not.toHaveBeenCalled()` checks during the typing phase, final `toHaveBeenCalledTimes(1)`.

---

## SCEN-010: pending debounce does not fire after unmount

**Given**: the hook is mounted with fake timers, `setFilter("search", "ana")` was called 100 ms ago (debounce scheduled).
**When**: the component unmounts before the 250 ms timer fires, then `vi.advanceTimersByTime(1000)`.
**Then**: `replaceMock` was never called. The cleanup effect cleared the pending timer.
**Evidence**: vitest with fake timers, unmount, advance, assert zero replace calls.

---

## SCEN-011: writeUrl skips replace when target equals current URL

**Given**: the current URL is `/reservations?q=ana` (i.e. `filters.franchise === ALL` already in URL state).
**When**: `setFilter("franchise", ALL)` fires (no-op — franchise is already absent).
**Then**: `router.replace` is NOT called, because the computed target equals the current `paramsKey`.
**Evidence**: vitest sets URL to `?q=ana`, mounts hook, acts `setFilter("franchise", ALL)`, asserts `replaceMock` has zero calls.

---

## SCEN-012: searchInput is render-synchronous, decoupled from URL

**Given**: the hook is mounted on `/reservations` (empty URL).
**When**: the operator calls `setFilter("search", "ana")` once (no timer advance).
**Then**: in the same render, `result.current.searchInput === "ana"`. AND `replaceMock` has NOT been called yet (URL change is debounced).
**Evidence**: vitest acts setFilter without advancing timers, immediately asserts both conditions.

---

## SCEN-013: clearAll resets filters + sort + page to defaults

**Given**: the operator is on `/reservations?franchise=alquilatucarro&q=ana&sort=pickup_date:asc&page=3`.
**When**: `clearAll()` fires.
**Then**: exactly one `router.replace` writes `/reservations` with no query. After the next render, `filters === INITIAL_FILTERS`, `searchInput === ""`, and `sorting === [PRIORITY_SORT, ...DEFAULT_USER_SORT]`. This is a deliberate broadening from the today's clear-filters-only behavior.
**Evidence**: vitest sets URL, acts `clearAll`, asserts `replaceMock` was called exactly once with a URL whose pathname is `/reservations` and query string is empty. Asserts the post-call state.

---

## SCEN-014: full pasted URL hydrates every UI control

**Given**: a teammate pastes `/reservations?franchise=alquilatucarro&status=pendiente&pickup_from=2026-05-01&pickup_to=2026-05-31&referral=<uuid>&q=lopez&sort=created_at:desc&page=2` into a new tab.
**When**: the page loads.
**Then**: `filters` reflects every key, `sorting === [PRIORITY_SORT, { id: "created_at", desc: true }]`, `pagination === { pageIndex: 1, pageSize: 20 }`, `searchInput === "lopez"`.
**Evidence**: vitest with the URL above, single assertion of the full return value.

---

## SCEN-015: browser back restores the URL after navigation

**Given**: the operator is on `/reservations?q=ana`.
**When**: they navigate to a detail page and press the browser back button.
**Then**: the URL is restored to `/reservations?q=ana` and the hook hydrates from it.
**Evidence**: runtime check via `/agent-browser` on the Vercel preview. The hook contract makes this work by virtue of `router.replace` always reflecting state to the URL bar; the browser's history then restores it on back.

---

## SCEN-016: mid-debounce navigation preserves the freshly-changed filter

**Given**: the operator is on `/reservations?status=pendiente`, types `"abc"` into the search box (debounce scheduled, not yet flushed).
**When**: before the 250 ms elapses they call `setFilter("status", "nueva")` (a non-debounced filter change) — the URL becomes `/reservations?status=nueva` immediately. The pending search debounce then fires.
**Then**: the resulting URL contains BOTH `status=nueva` AND `q=abc`. The ref-routed `writeUrl` reads the latest `paramsKey` (which includes `status=nueva`) at flush time, not the snapshot captured when the timer was scheduled.
**Evidence**: vitest with fake timers, simulate the typing + filter switch sequence, advance past the debounce, assert the final replaceMock URL contains both keys.
