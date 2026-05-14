# Reservations Table URL state — design

**Date:** 2026-05-14
**Issue:** [#27](https://github.com/amaw-sas/rentacar-dashboard/issues/27)
**Epic:** [#29](https://github.com/amaw-sas/rentacar-dashboard/issues/29)
**Author:** pabloandi

## Problem

`app/(dashboard)/reservations/reservations-table.tsx` holds the 9-dimension filter state, sorting, and pagination in local `useState`. Navigating to a reservation's detail or edit page and returning drops everything to defaults. The operator loses context after every drill-down — a real cost in repetitive flows (reviewing the day's pending pickups, walking through a city's queue, etc.).

The shared `<DataTable />` got URL persistence in #28. Reservations uses its own `reservations-table.tsx` because it needs richer filter UI (multi-select cardinality, two `DateRange` pickers, full-text search) and a pinned priority sort. The fix lives in a sibling hook scoped to this exact shape.

## Goals

- Persist all 9 filters, the user's sort, and the page across in-app navigation (detail, edit, sidebar, Cancel from the form).
- Make URLs shareable.
- Reuse the post-#28/#31 invariants without sharing code: `writeUrl` no-op skip, `autoResetPageIndex: false`, search debounce with a local input buffer.
- Surface the reservations FilterState shape after PR #34 landed (4 select strings + 2 `DateRange | undefined` + 1 search string).

## Non-goals

- Server-side filtering (still client-side over the `data` array the page loads).
- Cross-session persistence (URL only).
- A generic `useFiltersUrlState<T>()` hook. The reservations shape is specific enough that abstracting it now would design the wrong interface. Refactor when a third consumer appears.
- Touching `customers`/`commissions` or extracting common code with `useDataTableUrlState`.
- Reservation form Cancel/back UX (already shipped in #33).
- Persisting `columnVisibility` (the hidden `priority` column) in URL — stays as `initialState` config in the component, not URL-state.

## Architecture

A single hook `hooks/use-reservations-table-url-state.ts` owns the URL ↔ state bridge for `/reservations`. The component keeps its render code (selects, `<DateRangePicker>`, `<Input>` search, filter helpers `matchesSearch` / `matchesCity` / `isWithinDateRange`) and reads its three pieces of state from the hook.

```
URL (?franchise=…&status=…&pickup_from=…&q=…&sort=…&page=…)
        ↑↓ useSearchParams / router.replace
useReservationsTableUrlState()
        ├─ enum parser  (franchise, status — sentinel ALL ↔ key absent)
        ├─ UUID parser  (city, referral — sentinel ALL ↔ key absent)
        ├─ DateRange decoder (2 ISO keys ↔ react-day-picker DateRange)
        ├─ search debounce + local buffer (DOM-sync)
        ├─ sort: strip / re-prepend PRIORITY_SORT
        └─ pagination: 1-based URL, controlled in react-table
        ↑↓
reservations-table.tsx render
```

`lib/date-range.ts` gains one helper: `fromLocalIsoDate(iso: string): Date | undefined`, the inverse of the existing `toLocalIsoDate`. Same module so the round-trip is colocated.

## Hook API

```ts
// hooks/use-reservations-table-url-state.ts

interface UseReservationsTableUrlStateOptions {
  pageSize?: number;          // default 20
  searchDebounceMs?: number;  // default 250
}

interface UseReservationsTableUrlStateReturn {
  filters: FilterState;                       // URL-derived
  searchInput: string;                        // local buffer for the <Input>
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  clearAll: () => void;

  sorting: SortingState;                      // PRIORITY_SORT pinned at index 0
  pagination: PaginationState;

  onSortingChange: OnChangeFn<SortingState>;
  onPaginationChange: OnChangeFn<PaginationState>;
}

export function useReservationsTableUrlState(
  options?: UseReservationsTableUrlStateOptions,
): UseReservationsTableUrlStateReturn;
```

### Ownership of types and constants

The hook owns the URL-derived contract. The component imports from the hook, not the other way around:

```ts
// hooks/use-reservations-table-url-state.ts
export const ALL = "__all__";
export const PRIORITY_SORT = { id: "priority", desc: false } as const;
export const DEFAULT_USER_SORT: SortingState = [{ id: "created_at", desc: true }];

export interface FilterState {
  franchise: string;      // FRANCHISES enum value, or ALL
  status: string;         // RESERVATION_STATUSES enum value, or ALL
  city: string;           // city id, or ALL
  referral: string;       // referral id, or ALL
  createdRange: DateRange | undefined;
  pickupRange: DateRange | undefined;
  search: string;
}

export const INITIAL_FILTERS: FilterState = {
  franchise: ALL,
  status: ALL,
  city: ALL,
  referral: ALL,
  createdRange: undefined,
  pickupRange: undefined,
  search: "",
};
```

`reservations-table.tsx` imports `ALL`, `FilterState`, etc. from the hook. The current in-component declarations are removed. `ALL_CITIES` (already exported) keeps re-exporting `ALL` for backward compat with any consumers.

### Search is collapsed into `setFilter` (intentional divergence from #28)

Reservations' UI code uses a uniform `update(key, value)` for all 9 filter dimensions today. Replacing it with `url.setFilter(key, value)` keeps the call sites uniform — the hook routes search through the debounce + buffer path internally. #28 exposed a separate `setSearchInput` because its `DataTable` consumer has a single search column. Reservations has 9 mixed-shape filters and uniformity wins here.

The consumer still binds `<Input value={url.searchInput}>` to read the buffer (separate from `url.filters.search` which holds the URL-flushed value).

### Integration in `reservations-table.tsx`

The three `useState` calls and the custom `setSorting` priority-pinning callback go away. The hook owns all of that. `update(key, value)` is replaced by `url.setFilter(key, value)`. The search `<Input>` binds `value={url.searchInput}`. Selects and `<DateRangePicker>`s bind `value={url.filters.X}` and `onChange={(v) => url.setFilter("X", v)}`.

```tsx
const url = useReservationsTableUrlState();

const filtered = useMemo(() => data.filter(/* uses url.filters.* */), [data, url.filters]);

const table = useReactTable({
  data: filtered,
  columns,
  state: { sorting: url.sorting, pagination: url.pagination },
  onSortingChange: url.onSortingChange,
  onPaginationChange: url.onPaginationChange,
  initialState: {
    columnVisibility: { priority: false },  // preserved from today — the priority column is internal
  },
  autoResetPageIndex: false,
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
});
```

The hook does not return `onColumnFiltersChange` — reservations filters in the `useMemo` outside react-table; there are no column-level filters to manage.
```

## URL schema

Flat keys at root. Empty/default values omitted to keep URLs short.

| Key            | Format               | Present when                                                                  |
|----------------|----------------------|-------------------------------------------------------------------------------|
| `franchise`    | enum string          | `filters.franchise !== ALL`                                                   |
| `status`       | enum string          | `filters.status !== ALL`                                                      |
| `city`         | UUID                 | `filters.city !== ALL`                                                        |
| `referral`     | UUID                 | `filters.referral !== ALL`                                                    |
| `created_from` | `yyyy-mm-dd`         | `filters.createdRange?.from` defined                                          |
| `created_to`   | `yyyy-mm-dd`         | `filters.createdRange?.to` defined                                            |
| `pickup_from`  | `yyyy-mm-dd`         | `filters.pickupRange?.from` defined                                           |
| `pickup_to`    | `yyyy-mm-dd`         | `filters.pickupRange?.to` defined                                             |
| `q`            | free text            | `filters.search` non-empty                                                    |
| `sort`         | `col:asc\|desc`      | The user has applied a sort beyond `PRIORITY_SORT`                            |
| `page`         | integer ≥ 1          | `pagination.pageIndex > 0` and `≤ MAX_PAGE`                                   |

Foreign keys (anything outside this set) are preserved verbatim during writes — the hook reads the current `searchParams`, overrides only its managed keys, and writes the rest back.

## Behavior rules

- **History**: every URL update uses `router.replace`, never `push`. No history bloat as the operator scrubs filters.
- **No-op skip**: lifted from #31 — if the new query string equals the current `paramsKey`, the hook skips the `router.replace` entirely. Defends against silent RSC fetch loops if any code path produces a same-href write.
- **Search debounce**: `setFilter("search", value)` updates `searchInput` synchronously (so the typed character appears immediately) and schedules a 250 ms write to the URL. A pending timer is cleared on unmount and on `pathname` change.
- **Other setters write immediately**: select changes, DateRangePicker selections, sort header clicks, page changes — all `router.replace` synchronously.
- **Page reset**: any filter or sort change drops the `page` key (back to page 1). Changing the page alone does not touch filters or sort.
- **PRIORITY_SORT**: never serialized to the URL. The hook strips it from the array before encoding and re-prepends it after decoding. The user only ever sees their own sort in the URL.
- **Default user sort**: when the URL has no `sort` key, the hook hydrates `sorting` to `[PRIORITY_SORT, ...DEFAULT_USER_SORT]` — preserving today's default of "newest first". Serialization writes `?sort=` only when the user's sort differs from `DEFAULT_USER_SORT`; setting sort back to the default drops the URL key.
- **`clearAll`**: a single `router.replace` to `pathname` with foreign params preserved. Local `searchInput` reset to empty. The pending debounce is cancelled. This is a deliberate behavior change from today: previously `clearAll` only reset filters and kept the user's sort. Now it resets filters + sort + page to defaults — matching the "back to a clean slate" mental model of a "Limpiar filtros" button.
- **Ref-routed `writeUrl`**: lifted from #31 — the debounce flush reads `writeUrl` through a `useRef` so a flush that fires after the URL has changed (e.g. the operator clicks a different filter mid-debounce) still writes against the latest `paramsKey`, preserving the foreign keys that just landed.

## Robustness

- Unknown `franchise`/`status` enum values: parser treats as `ALL` (no filter). Tolerant of renames or stale links.
- Malformed `city`/`referral` UUIDs: passed through to the filter logic. Result is the empty list, which makes the bad value obvious to the operator.
- `?created_from=garbage`: parser ignores, equivalent to `undefined`.
- `?created_from > created_to`: hydrated as-is. `isWithinDateRange` returns no matches. Acceptable — the operator sees the empty result and re-picks.
- `?sort=col:bad` or `?sort=...:::extra`: ignored. `sorting` stays as `[PRIORITY_SORT]`.
- `?page=abc` / `?page=1e10` / `?page=-3`: coerced to 1. Reuses the `PAGE_DIGITS_RE` + `MAX_PAGE=10_000` pattern from `use-data-table-url-state`.

## Migration (file map)

| File                                                                       | Change    | Responsibility                                                                                                          |
|----------------------------------------------------------------------------|-----------|-------------------------------------------------------------------------------------------------------------------------|
| `hooks/use-reservations-table-url-state.ts`                                | New       | URL ↔ state bridge for reservations. Owns PRIORITY_SORT pinning, DateRange round-trip, search debounce + buffer.        |
| `lib/date-range.ts`                                                        | Edit      | Add `fromLocalIsoDate(iso): Date \| undefined` — inverse of `toLocalIsoDate`.                                           |
| `app/(dashboard)/reservations/reservations-table.tsx`                      | Edit      | Replace 3 `useState` + priority-pin callback with the hook. Add `autoResetPageIndex: false`. Bind UI to hook.           |
| `tests/unit/hooks/use-reservations-table-url-state.test.ts`                | New       | Vitest suite for SCEN-001..015.                                                                                         |
| `tests/unit/lib/date-range.test.ts`                                        | Edit      | Already exists. Add `fromLocalIsoDate` round-trip cases.                                                                |

Blast radius: 1 new hook, 1 helper added to an existing module, 1 component edit, 2 test files. No new dependencies, no DB changes, no API surface impact on other listings. Single consumer for the hook.

## Risks

- **DateRange timezone subtleties**: ISO dates in URLs are wall-clock dates, while `new Date("2026-05-01")` parses as UTC midnight. The new helper `fromLocalIsoDate` constructs via `new Date(y, m-1, d)` to match `toLocalIsoDate`. Round-trip is the canonical SCEN-003 to lock this.
- **PRIORITY_SORT divergence**: if the hook forgets to re-prepend priority on hydration, priority reservations stop floating to the top. Covered explicitly by SCEN-006.
- **Pagination control flip**: today `reservations-table.tsx` runs pagination uncontrolled (only `initialState.pagination.pageSize`). Switching to controlled may surface react-table edge cases (`pageIndex` out of range when filters shrink the row count). `autoResetPageIndex: false` matches the post-#31 pattern; SCEN-007 (page reset on filter change) covers the user-visible side.
- **Long URLs**: 11 keys + UUIDs can produce ~250-char URLs. Well below browser limits but worth noting for shareability.

## Validation strategy

### Unit tests (`tests/unit/hooks/use-reservations-table-url-state.test.ts`)

Encode SCEN-001..015 directly. Mock `next/navigation` the same way `tests/unit/hooks/use-data-table-url-state.test.ts` does. Use `vi.useFakeTimers()` for the debounce tests. Mount via `renderHook` from `@testing-library/react` 16.

### Helper test (`tests/unit/lib/date-range.test.ts`)

`fromLocalIsoDate("2026-05-14")` returns a `Date` whose `getFullYear/Month/Date` match the input in local TZ. Malformed inputs return `undefined`. Round-trip `toLocalIsoDate(fromLocalIsoDate("2026-02-29"))` returns the same string (Feb 29 in a leap year).

### CI gate

`pnpm type-check && pnpm lint && pnpm test && pnpm build` — all exit 0.

### Runtime verification (`/agent-browser` on the Vercel preview after deploy)

1. Apply three filters (franchise, status, DateRange pickup), open a reservation's edit page, click Cancelar — listing renders with all three filters intact.
2. Browser back ← from a detail page — URL preserved by browser history.
3. Paste `/reservations?franchise=alquilatucarro&status=pendiente&pickup_from=2026-05-01&q=lopez&sort=created_at:desc&page=2` into a new tab — DOM shows all selected values, the sort indicator, and the correct page.
4. Type in the search box — URL bar updates 250 ms after the last keystroke, only one RSC fetch fires (no loop).
5. Move to page 2 with filters active — filters and sort survive the page change.
6. Click "Limpiar filtros" — URL settles at `/reservations` with no query.
7. Console must be clean (zero errors, zero failed requests).

## Observable scenarios (handoff to /scenario-driven-development)

1. **SCEN-001** — *Given* the operator pastes `/reservations?franchise=alquilatucarro&status=pendiente&city=<uuid>&q=lopez`, *when* the page mounts, *then* `filters.franchise === "alquilatucarro"`, `filters.status === "pendiente"`, `filters.city` is that UUID, `filters.search === "lopez"`, and `searchInput === "lopez"`.
2. **SCEN-002** — *Given* `filters.franchise === ALL`, *when* the hook serializes URL, *then* the URL has no `franchise` key.
3. **SCEN-003** — *Given* `setFilter("createdRange", { from: 2026-05-01, to: 2026-05-31 })`, *when* the URL is re-parsed, *then* the resulting `filters.createdRange.from` has `getFullYear() === 2026`, `getMonth() === 4`, `getDate() === 1`, and `filters.createdRange.to` has `getFullYear() === 2026`, `getMonth() === 4`, `getDate() === 31` — all in local TZ. Round-trip is exact across DST and leap-year boundaries.
4. **SCEN-004** — *Given* a URL with `?created_from=2026-05-01` only, *when* the hook hydrates, *then* `filters.createdRange === { from: Date(May 1 local), to: undefined }`.
5. **SCEN-005** — *Given* `setSorting([PRIORITY_SORT, { id: "created_at", desc: true }])`, *when* writeUrl fires, *then* `?sort=created_at:desc` is written (no `priority` segment in the URL).
6. **SCEN-006** — *Given* a URL with `?sort=pickup_date:asc`, *when* the hook hydrates, *then* `sorting === [PRIORITY_SORT, { id: "pickup_date", desc: false }]` with PRIORITY_SORT at index 0.

   **SCEN-006b (default-sort fallback)** — *Given* a URL with no `sort` key, *when* the hook hydrates, *then* `sorting === [PRIORITY_SORT, { id: "created_at", desc: true }]` (PRIORITY_SORT + DEFAULT_USER_SORT). Serialization of that exact state back to URL drops the `sort` key (no redundant defaults in URL).
7. **SCEN-007** — *Given* the operator is on `/reservations?page=3`, *when* they change any filter or sort, *then* the resulting URL drops `page`.
8. **SCEN-008** — *Given* filters and sort active, *when* `onPaginationChange({ pageIndex: 1, pageSize: 20 })` fires, *then* the URL gains `page=2` and the filter/sort keys are unchanged.
9. **SCEN-009** — *Given* the hook is mounted, *when* the operator types 5 characters into the search input within 100 ms each (total < 250 ms idle), *then* exactly one `router.replace` fires after the final keystroke + 250 ms.
10. **SCEN-010** — *Given* the hook is mounted with a pending debounce, *when* the component unmounts before the 250 ms timer fires, *then* `router.replace` is never invoked.
11. **SCEN-011** — *Given* the current URL is `/reservations?q=ana`, *when* `setFilter("franchise", ALL)` fires (no-op vs. current URL because `franchise` is already absent), *then* `router.replace` is not called.
12. **SCEN-012** — *Given* the hook is mounted, *when* the operator types one character into the search input, *then* `searchInput` updates synchronously in the same render cycle. The URL has not changed yet.
13. **SCEN-013** — *Given* filters, sort (non-default), and page are all set in the URL, *when* `clearAll()` fires, *then* exactly one `router.replace` writes `/reservations` (no query), `searchInput` resets to empty, `filters === INITIAL_FILTERS`, and `sorting` falls back to `[PRIORITY_SORT, ...DEFAULT_USER_SORT]`. This is a deliberate broadening from today's clear-filters-only behavior.
14. **SCEN-014** — *Given* a teammate pastes `/reservations?franchise=alquilatucarro&status=pendiente&pickup_from=2026-05-01&pickup_to=2026-05-31&referral=<uuid>&q=lopez&sort=created_at:desc&page=2` in a new tab, *when* the page loads, *then* every UI control reflects its corresponding URL key and the rows are filtered/sorted/paginated accordingly.
15. **SCEN-015** — *Given* the operator is on `/reservations?q=ana`, *when* they click into a reservation detail and press the browser back button, *then* the URL is restored to `/reservations?q=ana` and the hook hydrates from it.

16. **SCEN-016 (mid-debounce navigation)** — *Given* the operator is on `/reservations?status=pendiente` and types `"abc"` in the search box, *when* — before the 250 ms debounce fires — they click a different filter (e.g. switch `status` to `nueva`), *then* the eventual debounce flush writes a URL that contains BOTH the new filter (`status=nueva`) AND the typed search (`q=abc`). The hook's ref-routed `writeUrl` reads the latest `paramsKey` at flush time, not the snapshot captured when the timer was scheduled.
