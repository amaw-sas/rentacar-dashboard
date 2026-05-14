---
name: data-table-url-state
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-13T00:00:00Z
spec: docs/specs/2026-05-13-data-table-url-state-design.md
issue: 28
epic: 29
---

# Scenarios — DataTable URL state preservation

Holdout contract for issue #28. Write-once after first commit.
Mirrors the "Observable scenarios" section of the design spec.

The 8 listings that consume `<DataTable />` are: categories, cities, customers, franchises, locations, referrals, rental-companies, commissions/imports. The 9th consumer is commissions/page.tsx (which also has server-side filters). `customers` and `commissions` are the canonical runtime verification targets.

---

## SCEN-001: search input survives navigation to detail and cancel
**Given**: the operator is at `/customers`, has typed `"lopez"` in the search box, and the 250ms debounce has flushed so the URL is `/customers?q=lopez`.
**When**: they click a customer row to navigate to `/customers/<id>`, then click **Cancel** (which routes back to `/customers`).
**Then**: the listing renders with `"lopez"` still in the input, the URL still contains `?q=lopez`, and the filtered list is identical to what was shown before navigation.
**Evidence**: agent-browser run captures: (a) URL after debounce flush, (b) URL after cancel, (c) DOM contents of the search input before and after. Vitest test for the hook asserts that hydrating from `?q=lopez` produces a `ColumnFiltersState` containing `{ id: searchColumn, value: "lopez" }`.

---

## SCEN-002: sort + pagination survive browser back
**Given**: the operator sorted `/customers` by `full_name asc` (URL `/customers?sort=full_name:asc&page=2`) and is on page 2.
**When**: they navigate to a customer detail page and press the browser back button.
**Then**: the listing renders with the sort indicator on `full_name asc` and the pagination on page 2; the URL is unchanged.
**Evidence**: agent-browser run with browser back action. Vitest test asserts the hook parses `?sort=full_name:asc&page=2` into `SortingState: [{ id: "full_name", desc: false }]` and `PaginationState: { pageIndex: 1, pageSize: 20 }`.

---

## SCEN-003: pasted URL hydrates listing to the encoded state
**Given**: a teammate is sent the URL `/customers?q=lopez&sort=full_name:asc&page=2`.
**When**: they paste it into a new browser tab and the page loads.
**Then**: the search input shows `"lopez"`, the column header for `full_name` shows the ascending sort indicator, the pagination footer shows page 2 of N, and the filtered+sorted+paginated rows match the encoded state.
**Evidence**: agent-browser run loads the URL fresh (no prior navigation) and asserts DOM state. Vitest test asserts the hook returns the correct `state` object for that exact `searchParams`.

---

## SCEN-004: client-side search composes with server-side filter
**Given**: the operator is at `/commissions?match_status=unmatched` (server-side filter), and types `"abc"` into the search box.
**When**: the 250ms debounce elapses.
**Then**: the URL becomes `/commissions?match_status=unmatched&q=abc`, the page is NOT re-fetched from the server (no full reload because `router.replace` shallow-updates the client URL), the server-side filter remains applied to the dataset already loaded, AND the client-side `?q=abc` further narrows the visible rows.
**Evidence**: agent-browser captures network log (no commission-list fetch fired) and final URL. Vitest test asserts the hook reads `match_status=unmatched` from the existing `searchParams` and produces a write that preserves it.

---

## SCEN-005: clicking a server-side badge preserves client-side search
**Given**: the operator is at `/commissions?match_status=unmatched&q=abc`.
**When**: they click the `payment_status=pending` badge (a server-side filter `Link` built by `buildFilterUrl`).
**Then**: the resulting URL contains BOTH the new `payment_status=pending` AND the preserved `q=abc` (and any active `sort`/`page`). The client-side state is preserved as the page re-renders.
**Evidence**: agent-browser captures URL after badge click. Source-diff inspection confirms `buildFilterUrl` in `app/(dashboard)/commissions/page.tsx` forwards `q`, `sort`, `page` from the incoming `searchParams`.

---

## SCEN-006: changing search resets pagination to page 1
**Given**: the operator is at `/customers?page=3` showing page 3 of the unfiltered list.
**When**: they type any non-empty value into the search box and the debounce flushes.
**Then**: the URL becomes `/customers?q=<value>` (page key dropped) and the listing renders the first page of the filtered results.
**Evidence**: agent-browser run. Vitest test asserts that calling `onColumnFiltersChange` with a non-empty filter while `page > 1` produces a `router.replace` whose URL omits the `page` key.

---

## SCEN-007: changing page preserves search and sort
**Given**: the operator is at `/customers?q=lopez&sort=full_name:asc` on page 1.
**When**: they click "Siguiente" to advance to page 2.
**Then**: the URL becomes `/customers?q=lopez&sort=full_name:asc&page=2` — `q` and `sort` are preserved.
**Evidence**: agent-browser run. Vitest test asserts that calling `onPaginationChange` with `{ pageIndex: 1, pageSize: 20 }` while `q=lopez&sort=full_name:asc` are present produces a write that preserves both.

---

## SCEN-008: malformed URL params sanitize without throwing
**Given**: a stray URL `/customers?page=abc&sort=full_name:invalid&q=`.
**When**: the page loads.
**Then**: the rendered state is `page=1` (no sort applied), and no errors are logged to the console; the search input is empty. The URL is NOT auto-rewritten (the bad params remain until the user changes filters).
**Evidence**: agent-browser run inspecting console + DOM. Vitest test feeds the hook a `searchParams` object containing `page=abc`, `sort=full_name:invalid`, `q=""` and asserts the returned `state` is the default state (no `sort`, `pageIndex: 0`, empty `columnFilters` for the search column).

---

## SCEN-009: debounce coalesces rapid typing into one URL write
**Given**: the hook is mounted on `/customers` with an empty `?q=`.
**When**: the user types five characters within a span of 100ms each (total elapsed ~500ms) and pauses.
**Then**: exactly ONE call to `router.replace` is made — after the final keystroke + 250ms idle. Intermediate keystrokes do not produce URL updates.
**Evidence**: vitest test using `vi.useFakeTimers()` simulates five sequential `onColumnFiltersChange` calls with 100ms gaps and asserts the mocked `router.replace` is called exactly once with the final value after advancing past the 250ms debounce.

---

## SCEN-010: pending debounce does not fire after unmount
**Given**: the hook is mounted, the user types one character (debounce timer started), and 100ms later the listing unmounts (navigation to a detail page) before the 250ms debounce flushes.
**When**: the 250ms mark would have been reached.
**Then**: NO call to `router.replace` is made — the cleanup function cancelled the pending timer.
**Evidence**: vitest test mounts the hook, calls a setter, unmounts before the timer fires, advances fake timers past the debounce, and asserts `router.replace` was never invoked.
