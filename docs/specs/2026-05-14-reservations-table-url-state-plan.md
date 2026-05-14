# Implementation Plan — Reservations Table URL state preservation

**Date**: 2026-05-14
**Spec**: `docs/specs/2026-05-14-reservations-table-url-state-design.md`
**Scenarios**: `docs/specs/2026-05-14-reservations-table-url-state/scenarios/reservations-table-url-state.scenarios.md`
**Issue**: [#27](https://github.com/amaw-sas/rentacar-dashboard/issues/27)
**Epic**: [#29](https://github.com/amaw-sas/rentacar-dashboard/issues/29)

## Goal

Persist the 9-dimension filter state, the user's sort, and the page across in-app navigation on `/reservations`. The hook `useReservationsTableUrlState` owns the URL ↔ state bridge; `reservations-table.tsx` consumes it and drops three `useState` calls and a priority-pinning sort callback.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `lib/date-range.ts` | Edit | Add `fromLocalIsoDate(iso: string): Date \| undefined` — inverse of the existing `toLocalIsoDate`. |
| `tests/unit/lib/date-range.test.ts` | Edit | Round-trip cases for `fromLocalIsoDate` + malformed inputs. |
| `hooks/use-reservations-table-url-state.ts` | New | URL ↔ state bridge. Owns `FilterState`, `ALL`, `PRIORITY_SORT`, `DEFAULT_USER_SORT`, `INITIAL_FILTERS`. Implements writeUrl no-op skip, search debounce + buffer, ref-routed writeUrl, PRIORITY_SORT pinning. |
| `tests/unit/hooks/use-reservations-table-url-state.test.ts` | New | Encodes SCEN-001..016 from the scenarios file. |
| `app/(dashboard)/reservations/reservations-table.tsx` | Edit | Drop the 3 `useState` calls and the custom `setSorting` priority-pin callback. Import `FilterState`/`ALL`/`PRIORITY_SORT`/`INITIAL_FILTERS` from the hook. Bind selects, `DateRangePicker`s, search Input to `url.setFilter` / `url.searchInput`. Pass `autoResetPageIndex: false` and `initialState.columnVisibility: { priority: false }` to `useReactTable`. |

No new directories, no new dependencies (`react-day-picker` already in tree from #34), no DB changes.

## Prerequisites

- `pnpm install` (no new packages).
- Main at `ef375ea` or later (post-#34 / DateRangePicker landed).

## Implementation Steps

### Step 1 — Pin scenarios as the holdout contract

**Size**: S
**Dependencies**: none
**Scenarios driven**: none (contract pinning — this step commits the holdout file)

**What to do**:
1. Verify `docs/specs/2026-05-14-reservations-table-url-state/scenarios/reservations-table-url-state.scenarios.md` exists with 17 SCEN blocks (16 numbered + SCEN-006b).
2. Commit the scenarios file together with the design fold-in (already committed in `fc56cca` for design, this commit adds the scenarios file). Treat it as immutable from here on.

**Acceptance criteria**:
- `grep -c '^## SCEN-' docs/specs/2026-05-14-reservations-table-url-state/scenarios/*.md` returns `17`.
- Git log shows the scenarios committed before any code change.

---

### Step 2 — `fromLocalIsoDate` helper + tests (red → green together)

**Size**: S
**Dependencies**: Step 1
**Scenarios driven**: SCEN-003, SCEN-004 (helper underpins them)

**What to do**:
1. In `tests/unit/lib/date-range.test.ts`, add cases:
   - `fromLocalIsoDate("2026-05-14")` → Date where `getFullYear()/Month/Date` are 2026/4/14 in local TZ.
   - `fromLocalIsoDate("2024-02-29")` → leap-year date Feb 29 2024 local TZ.
   - `fromLocalIsoDate("invalid")` → `undefined`.
   - `fromLocalIsoDate("")` → `undefined`.
   - Round-trip: `toLocalIsoDate(fromLocalIsoDate("2026-05-14")!)` === `"2026-05-14"`.
2. In `lib/date-range.ts`, add:
   ```ts
   export function fromLocalIsoDate(iso: string): Date | undefined {
     const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
     if (!m) return undefined;
     const [, y, mo, d] = m;
     return new Date(Number(y), Number(mo) - 1, Number(d));
   }
   ```

**Acceptance criteria**:
- `pnpm test tests/unit/lib/date-range.test.ts --run` → all new cases pass.
- `pnpm type-check` clean.

---

### Step 3 — Hook skeleton + URL parsing tests (red)

**Size**: M
**Dependencies**: Step 2
**Scenarios driven**: SCEN-001 (filters hydration half), SCEN-004, SCEN-006, SCEN-006b, SCEN-014 (filters hydration half). The `searchInput` half of SCEN-001/SCEN-014 lands in Step 6 when the buffer is wired in.

**What to do**:
1. Create `hooks/use-reservations-table-url-state.ts` with:
   - Exports `ALL`, `PRIORITY_SORT`, `DEFAULT_USER_SORT`, `INITIAL_FILTERS`, `FilterState` types.
   - Function signature matching the spec; returns defaults regardless of URL.
2. Create `tests/unit/hooks/use-reservations-table-url-state.test.ts`. Mock `next/navigation` the same way the #28 test file does (mutable `currentParams` URLSearchParams + `replaceMock`).
3. Write tests for URL hydration:
   - Empty URL → `filters === INITIAL_FILTERS`, `sorting === [PRIORITY_SORT, ...DEFAULT_USER_SORT]`, `pagination === { pageIndex: 0, pageSize: 20 }`, `searchInput === ""` (SCEN-006b).
   - Full URL with all keys → all values correctly hydrated (SCEN-001, SCEN-014).
   - `?created_from=2026-05-01` only → partial DateRange (SCEN-004).
   - `?sort=pickup_date:asc` → `sorting[1] === { id: "pickup_date", desc: false }` (SCEN-006).

**Acceptance criteria**:
- Tests written, currently FAIL because the skeleton returns defaults.
- `pnpm type-check` clean.

---

### Step 4 — Implement URL parsing (green for parsing scenarios)

**Size**: M
**Dependencies**: Step 3
**Scenarios driven**: SCEN-001 hydration, SCEN-004, SCEN-006, SCEN-006b, SCEN-014 hydration

**What to do**:
1. Implement `useMemo` parsing keyed on `paramsKey`:
   - `parseFilters(params, ALL)` → `FilterState` (enums fall back to ALL on unknown).
   - `parseDateRange(params, fromKey, toKey)` → `DateRange | undefined` using `fromLocalIsoDate`.
   - `parseSort(params)` → `SortingState`: parse `sort=col:dir`, ignore malformed, ALWAYS prepend PRIORITY_SORT; if no URL sort, use `[PRIORITY_SORT, ...DEFAULT_USER_SORT]`.
   - `parsePagination(params, pageSize)` → with `PAGE_DIGITS_RE` + `MAX_PAGE=10_000` from #28.
   - `parseSearchInput`: `params.get("q") ?? ""` (the buffer initial value).

**Acceptance criteria**:
- All parsing tests from Step 3 PASS.
- `pnpm type-check` and `pnpm lint` clean.

---

### Step 5 — Writers + setter tests (red → green)

**Size**: M
**Dependencies**: Step 4
**Scenarios driven**: SCEN-002, SCEN-003 (DateRange round-trip via writeUrl), SCEN-005, SCEN-007, SCEN-008, SCEN-011, SCEN-013

**What to do**:
1. Add setter tests:
   - SCEN-002: `setFilter("franchise", ALL)` produces URL without `franchise` key.
   - SCEN-003: `setFilter("createdRange", { from, to })` round-trips via writeUrl + re-hydration — exact Y/M/D match across leap year (Feb 29 2024) and year-boundary (Dec 31 2026 → Jan 1 2027).
   - SCEN-005: `onSortingChange([PRIORITY_SORT, {id:"pickup_date",desc:false}])` writes `sort=pickup_date:asc`, no `priority` substring.
   - SCEN-007: `setFilter("city", uuid)` while URL has `page=3&status=pendiente` writes URL with `city`, retains `status`, drops `page`.
   - SCEN-008: `onPaginationChange({pageIndex:1, pageSize:20})` while URL has `status=pendiente&sort=pickup_date:asc` preserves all and adds `page=2`.
   - SCEN-011: writeUrl no-op skip — `setFilter("franchise", ALL)` while URL already has no `franchise` key results in zero replaceMock calls.
   - SCEN-013: `clearAll()` writes `/reservations` with no query.
2. Implement writers in the hook:
   - `writeUrl(updates: Partial<Record<key, string|null>>, opts: { resetPage })`: builds new URLSearchParams from current `paramsKey`, applies updates (null → delete, string → set), drops `page` if resetPage, **skips `router.replace` if `qs === paramsKey`**.
   - `setFilter(key, value)`: routes by key. For ALL keys except `search`: write URL immediately. For DateRange keys (`createdRange`/`pickupRange`): serialize `from`/`to` to two URL keys via `toLocalIsoDate`. For sentinel ALL: delete key. resetPage: true for non-page writers.
   - `onSortingChange`: strip PRIORITY_SORT; if remaining user sort equals DEFAULT_USER_SORT, drop URL sort key; else write `col:asc|desc`. resetPage: true.
   - `onPaginationChange`: serialize pageIndex+1 to URL (`1` → drop key). resetPage: false.
   - `clearAll`: delete every managed key in one `writeUrl` call, preserving foreign keys (defensive even though /reservations has none today). Cancel pending debounce. Reset `searchInput` to "".

**Acceptance criteria**:
- All setter tests PASS.
- All previously-passing tests still PASS.
- `pnpm type-check` + `pnpm lint` clean.

---

### Step 6 — Search debounce + buffer (red → green)

**Size**: M
**Dependencies**: Step 5
**Scenarios driven**: SCEN-001 (searchInput buffer half), SCEN-009, SCEN-010, SCEN-012, SCEN-014 (searchInput buffer half), SCEN-016

**What to do**:
1. Add tests:
   - SCEN-012: `setFilter("search", "ana")` updates `searchInput` synchronously, no replace call yet.
   - SCEN-009: 5 rapid typing events 100ms apart, then advance 250ms — exactly one replace with final value.
   - SCEN-010: setFilter then unmount before 250ms — zero replace calls.
   - SCEN-016: mid-debounce filter change — debounce flush writes URL containing BOTH the new filter (set synchronously) and the typed search.
2. Implement:
   - `const [searchInput, setSearchInputState] = useState(urlSearchValue)` initialized from URL.
   - `useEffect` to sync `searchInput` to URL changes (when `urlSearchValue` changes externally).
   - `setFilter("search", v)`: clears pending timer, sets `searchInputState(v)` synchronously, schedules a 250ms timer that calls `writeUrlRef.current(...)` with the value.
   - `writeUrlRef = useRef(writeUrl)` updated in `useEffect([writeUrl])` so flushes read the latest `paramsKey`.
   - `useEffect` cleanup on unmount + `pathname` change cancels the pending timer.

**Acceptance criteria**:
- All debounce tests PASS.
- All previously-passing tests still PASS.

---

### Step 7 — Wire the hook into `reservations-table.tsx`

**Size**: M
**Dependencies**: Step 6
**Scenarios driven**: visual integration, no new unit scenarios (these are runtime checks)

**What to do**:
1. In `app/(dashboard)/reservations/reservations-table.tsx`:
   - Import `useReservationsTableUrlState`, `ALL`, `PRIORITY_SORT`, `INITIAL_FILTERS`, `FilterState` from the hook.
   - Remove the local declarations of `ALL`, `PRIORITY_SORT`, `initialFilters`, `FilterState` (keep `ALL_CITIES` re-exporting `ALL` for any external consumers).
   - Replace `const [filters, setFilters] = useState(initialFilters)`, the sorting `useState` + custom `setSorting`, and the columnFilters `useState` with `const url = useReservationsTableUrlState()`.
   - Replace `update(key, value)` with `url.setFilter(key, value)`.
   - Replace `clearAll` with `url.clearAll`.
   - Bind selects' `value` to `url.filters.X` and `onValueChange` to `(v) => url.setFilter("X", v)`.
   - Bind `DateRangePicker`s' `value` to `url.filters.createdRange`/`pickupRange` and `onChange` to `(r) => url.setFilter("createdRange", r)` etc.
   - Bind search `<Input value={url.searchInput}>` and `onChange={(e) => url.setFilter("search", e.target.value)}`.
   - `useReactTable` receives: `state: { sorting: url.sorting, pagination: url.pagination }`, `onSortingChange: url.onSortingChange`, `onPaginationChange: url.onPaginationChange`, `autoResetPageIndex: false`, `initialState: { columnVisibility: { priority: false } }`. Remove `columnFilters` and `onColumnFiltersChange` (no longer needed — reservations filters in `useMemo`).
   - Remove the `useCallback`-wrapped `setSorting` priority-pin callback (hook owns it now).

**Acceptance criteria**:
- `pnpm type-check` clean.
- `pnpm lint` clean.
- `pnpm test` → all 426+ tests still pass plus the new hook tests.
- `pnpm build` → success.

---

### Step 8 — Runtime verification on Vercel preview

**Size**: M
**Dependencies**: Step 7
**Scenarios driven**: SCEN-015 (browser back), plus end-to-end coverage of all SCENs

**What to do**:
1. Push branch, wait for Vercel preview build.
2. Use `/agent-browser` (or manual smoke) to verify on the preview URL:
   - Apply 3 filters (e.g. franchise + status + DateRange pickup), check URL bar updates and reflects all three.
   - Click "Editar" on a row → Cancelar → URL restored exactly.
   - Browser back ← from a detail page → URL restored.
   - Paste a full URL with all 11 keys in a new tab → DOM reflects everything.
   - Type in search → URL updates 250ms after last keystroke. No RSC fetch loop (confirm in Network tab — single fetch).
   - "Limpiar filtros" → URL becomes `/reservations` clean, page renders default state.
   - Console clean: zero errors, zero failed requests.

**Acceptance criteria**:
- All 6 runtime smoke checks pass.
- Console clean.
- Network shows no fetch loops.

---

## Testing Strategy

- **Unit (vitest)**: `tests/unit/hooks/use-reservations-table-url-state.test.ts` covers SCEN-001..014 + 016 (not SCEN-015 which is browser-back, runtime only).
- **Helper (vitest)**: `tests/unit/lib/date-range.test.ts` covers `fromLocalIsoDate` round-trip.
- **CI gate**: `pnpm type-check && pnpm lint && pnpm test && pnpm build` exit 0.
- **Runtime (agent-browser)**: SCEN-015 + sanity smoke of the user-facing flow on Vercel preview.

## Rollout Plan

- Branch: `feat/reservations-table-url-state` (already created from main).
- Single PR linking #27 and #29. Description references the spec + scenarios + plan and lists the runtime verification checklist.
- Quality Integration before merge: 4-agent parallel review (code-reviewer + simplifier + edge-case-detector + performance-engineer) — same protocol as #28/#30. Security-reviewer added before merge.
- Merge: merge commit (consistent with #30, #31, #33 history).
- Rollback: revert the merge commit. No data migrations, no env changes, no schema impact — pure client-side state code.

## Risk Watch

- **DateRange TZ edge cases**: covered by SCEN-003. Add explicit leap-year + boundary tests.
- **PRIORITY_SORT divergence**: covered by SCEN-005/006/006b/007.
- **Pagination control flip from uncontrolled to controlled**: covered by SCEN-007/008 + runtime smoke.
- **autoResetPageIndex regression**: prevented by passing `autoResetPageIndex: false` to `useReactTable` (Step 8); explicitly listed in the file map.
- **`columnVisibility: { priority: false }` regression**: prevented by preserving it in `initialState` (Step 8); the spec calls this out explicitly.
