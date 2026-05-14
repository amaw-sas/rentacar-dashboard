---
name: reservations-table-url-state-followups
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-14T17:00:00Z
spec: docs/specs/2026-05-14-reservations-table-url-state-design.md
parent_scenarios: docs/specs/2026-05-14-reservations-table-url-state/scenarios/reservations-table-url-state.scenarios.md
issue: 27
---

# Scenarios — Reservations table URL state follow-ups from Quality Integration

Quality Integration on commit eeef44f surfaced four real bug classes the original 17 scenarios missed. Parent file stays write-once.

---

## SCEN-017: inverted DateRange (`from > to`) is normalized at parse time

**Given**: a URL `/reservations?pickup_from=2026-12-31&pickup_to=2026-01-01` (endpoints inverted — realistic vectors: hand-edited share link, react-day-picker mid-drag emission, paste from chat).
**When**: the hook hydrates.
**Then**: `filters.pickupRange` reports `from = Jan 1 2026` and `to = Dec 31 2026` — the endpoints are swapped so the row predicate `isWithinDateRange` matches the operator's intended range. The same normalization applies to `createdRange`.
**Evidence**: vitest sets the URL with inverted dates, asserts `range.from.getMonth() === 0` and `range.to.getMonth() === 11`. Before the fix the same URL would filter every row to empty silently.

---

## SCEN-018: out-of-range page on small datasets clamps back to page 1

**Given**: a bookmark `/reservations?page=5` opened against a dataset with only enough rows for page 1.
**When**: the page mounts (or the dataset shrinks after a `revalidatePath`).
**Then**: the component detects `pagination.pageIndex >= pageCount` while `filtered.length > 0` and triggers `onPaginationChange({ pageIndex: 0, pageSize })`, dropping the `?page` key from the URL. The operator lands on page 1 of the filtered set instead of seeing "Sin resultados" against rows that exist on earlier pages.
**Evidence**: source-diff inspection of `reservations-table.tsx` — a `useEffect` watches the filtered count and current pageIndex and corrects when the bookmark is stale. Runtime check on Vercel preview: open `/reservations?page=5` against any small filter; expect URL to settle without `?page` and rows on page 1 to render.

---

## SCEN-019: external URL change cancels pending search debounce

**Given**: the operator is typing into the search box (debounce timer scheduled, 250 ms not yet elapsed), then the URL changes externally — browser back, sidebar click, "Limpiar filtros".
**When**: the URL change lands in `useSearchParams` and the hook re-renders.
**Then**: the pending debounce timer is cancelled before it can fire. The external URL state is preserved; the operator's in-flight typing is discarded along with the URL change they explicitly requested.
**Evidence**: vitest with fake timers — schedule a search via `setFilter("search", "abc")`, externally change the URL to a different state via `setUrl` + `rerender`, advance timers past 250 ms, assert `router.replace` was NOT called from the debounce path.

---

## SCEN-020: search input is capped at SEARCH_MAX_LEN characters

**Given**: the operator pastes a multi-KB string into the search input (accidental clipboard — OCR text, JSON blob, email body).
**When**: the debounce flushes.
**Then**: both the local buffer (`searchInput`) and the `?q` URL key are truncated to `SEARCH_MAX_LEN = 200` characters. This prevents:
1. Browser URL bar truncation that makes the URL un-shareable.
2. Vercel edge 414 errors (request line > 16 KB).
3. Garbage payloads in the analytics that read URLs.
**Evidence**: vitest sets `setFilter("search", "x".repeat(5000))`, advances timers, asserts the URL's `q` is exactly 200 characters AND `searchInput` is also 200 characters (synchronous truncation in both paths).

---

## Not folded into this PR (deliberately deferred)

- **DateRangePicker stale-tick under React 19 transitions** (HIGH from edge-case-detector): theoretical under default React 19 settings; only observable with devtools slow-rendering emulation. If reports surface in production, mirror the search-input buffer pattern for the date pickers. Documented in the design doc under risks.
- **`getCoreRowModel()` etc. inline factories** (MEDIUM from performance): cosmetic until the dataset crosses the 5k-row threshold. Same pattern as the sibling DataTable; fix in a sweep across both consumers when server-side filtering is wired (the natural follow-up for the pre-existing scalability finding).
- **Server-side filtering** (HIGH from performance): pre-existing — `getReservations()` loads the full table. The URL-state work is the prerequisite; the actual server push is its own PR.
