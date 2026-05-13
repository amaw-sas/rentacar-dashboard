# DataTable URL state — design

**Date:** 2026-05-13
**Issue:** [#28](https://github.com/amaw-sas/rentacar-dashboard/issues/28)
**Epic:** [#29](https://github.com/amaw-sas/rentacar-dashboard/issues/29)
**Author:** pabloandi

## Problem

The shared `components/data-table/data-table.tsx` keeps `sorting`, `columnFilters`, and pagination in local `useState`. Every listing that uses it (categories, cities, customers, franchises, locations, referrals, rental-companies, commissions imports, and the search input inside commissions) loses state when the user navigates to a detail/edit page and returns. Operators have to reapply filters constantly during repetitive flows.

The reservations listing (`reservations-table.tsx`) has the same symptom but uses its own table component — it is tracked separately in issue #27 and is out of scope here.

## Goals

- Persist search, sort, and pagination across navigation to detail/edit and back.
- Make URLs shareable (a teammate can send a link with the listing pre-filtered).
- Zero changes to the 9 consuming pages' public surface; the fix lives inside `DataTable` and a new hook.
- Coexist with the server-side filters that `commissions/page.tsx` already encodes in `searchParams`.

## Non-goals

- Visible `pageSize` selector. Page size stays hardcoded at 20.
- Multi-column filtering in `DataTable` — the current API only exposes a single `searchColumn`.
- Refactor of `reservations-table.tsx` (#27, follow-up).
- Moving filtering to the server.
- Persisting filters across browser sessions (URL only).

## Architecture

A single hook in `hooks/use-data-table-url-state.ts` owns the URL ↔ table-state bridge. `DataTable` consumes it and removes its local `useState`. The 9 consumer pages do not change. `commissions/page.tsx` gets one targeted change in its `buildFilterUrl` helper to preserve the new keys when building badge links.

```
URL (?q=…&sort=…&page=…)
        ↑↓
useDataTableUrlState()  ── hook (this PR)
        ↑↓
useReactTable() controlled state slots
        ↑↓
<DataTable> rendering
```

## Hook API

```ts
// hooks/use-data-table-url-state.ts

interface UseDataTableUrlStateOptions {
  searchColumn?: string;       // column id that backs ?q=
  pageSize?: number;           // default 20, not exposed in URL
  searchDebounceMs?: number;   // default 250
}

interface UseDataTableUrlStateReturn {
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  pagination: PaginationState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
  onSortingChange: OnChangeFn<SortingState>;
  onPaginationChange: OnChangeFn<PaginationState>;
}

export function useDataTableUrlState(
  options?: UseDataTableUrlStateOptions
): UseDataTableUrlStateReturn;
```

Returns map 1:1 to the controlled-state slots `useReactTable` already accepts, so the integration is mechanical:

```tsx
const url = useDataTableUrlState({ searchColumn });
const table = useReactTable({
  data,
  columns,
  state: {
    sorting: url.sorting,
    columnFilters: url.columnFilters,
    pagination: url.pagination,
  },
  onSortingChange: url.onSortingChange,
  onColumnFiltersChange: url.onColumnFiltersChange,
  onPaginationChange: url.onPaginationChange,
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
});
```

## URL schema

Flat keys, empty values omitted:

| Key    | Format                  | When present                                              |
|--------|-------------------------|-----------------------------------------------------------|
| `q`    | `?q=texto`              | Only when the consumer set `searchColumn` and the value is non-empty. |
| `sort` | `?sort=column:asc\|desc` | Only when there is an active sort. Single column only. |
| `page` | `?page=N` (1-based)     | Only when `page > 1`. Page 1 is implicit. |

Keys outside this set are preserved verbatim — the hook reads `useSearchParams()` and merges, never replaces.

## Behavior rules

- **History**: every update uses `router.replace`, never `push`. No history pollution while the user types.
- **Debounce**: search input updates debounce 250ms before writing to the URL. Sort and pagination changes are immediate.
- **Page reset**: any change to `q` or `sort` resets `page` to 1 (drops the `?page=` key). Changing the page does not touch `q` or `sort`.
- **Preserve foreign keys**: when updating, the hook reads the current `searchParams`, overrides only its three managed keys, and keeps everything else (so commissions' `match_status`, `payment_status`, `import_batch_id` survive).
- **Cleanup**: pending debounce timers cancel on unmount.

## Robustness

- `?page=abc` or `?page=-1` → coerced to page 1.
- `?sort=col:foo` (invalid direction) → ignored, no sort applied.
- `?sort=nonexistent:asc` → passed through to react-table, which ignores unknown column ids without throwing.
- No `searchColumn` configured → `?q=` is ignored silently (no search input is rendered anyway).
- Empty string in `?q=` → treated as no filter; key is removed on the next write.

## Backward compatibility with `commissions/page.tsx`

`commissions/page.tsx:39-52` reads `match_status`, `payment_status`, `import_batch_id` from `searchParams` server-side and builds badge links via `buildFilterUrl`. These keys are orthogonal to `q`/`sort`/`page` and never collide.

Required adjustment: `buildFilterUrl` currently only carries `import_batch_id` between badge clicks. It must also preserve `q`, `sort`, and `page` so clicking a status badge does not wipe the operator's client-side filter. The change is local to one helper in one file.

## Migration

| File | Change |
|------|--------|
| `hooks/use-data-table-url-state.ts` | New file — the hook. |
| `components/data-table/data-table.tsx` | Replace local `useState` for `sorting`, `columnFilters`, and remove implicit pagination state from `initialState`. Wire the hook in. No public API change. |
| `app/(dashboard)/commissions/page.tsx` | Extend `buildFilterUrl` to forward `q`, `sort`, `page` from `searchParams`. |
| Other 8 listings | Zero changes — they inherit the fix through `DataTable`. |

Blast radius: 1 new file, 2 modified files. No schema migrations, no API surface changes, no breaking changes for consumers.

## Risks

- **Suspense boundary**: `useSearchParams()` in the App Router can require a Suspense boundary on the calling tree. `DataTable` is already a client component used inside server pages; verify in runtime that no warning fires.
- **First-render flicker**: react-table applies the URL-derived state on the first render. Confirm visually (agent-browser) that there is no flicker between default state and hydrated state.
- **Debounce + unmount**: pending timers must be cleared on unmount and on router navigation to avoid late writes. Standard cleanup pattern; covered by tests.

## Validation strategy

### Unit tests (`tests/unit/hooks/use-data-table-url-state.test.ts`)

- Parses `?q=&sort=&page=` correctly into react-table state shapes.
- `?page=abc` and `?sort=col:foo` sanitize to defaults without throwing.
- Changing the search filter resets `page`; changing sort resets `page`.
- Changing the page does not modify `q` or `sort`.
- Setters preserve unrelated `searchParams` keys.
- Rapid sequential search edits within 250ms produce a single `router.replace`.

### Runtime verification (`/agent-browser`)

Mandatory before closing the PR. Console must be clean (no errors, no failed requests):

1. `/customers`: type in the search box → click into a customer → cancel → state preserved.
2. `/customers`: sort a column → navigate to page 3 → enter a customer → browser back → state preserved.
3. `/commissions?match_status=unmatched`: type in `q` → enter a commission → cancel → both filters preserved.
4. Paste `/customers?q=lopez&sort=full_name:asc&page=2` in a new tab → listing opens with that state applied.
5. Clear input → URL `q` is dropped (not `?q=`).

### CI gate

`pnpm type-check && pnpm lint && pnpm test && pnpm build` must pass.

## Observable scenarios (handoff to /scenario-driven-development)

1. **Given** the operator is at `/customers` and has typed `"lopez"` in the search box, **when** they click a row to view the customer and then press **Cancel**, **then** they land back at `/customers` with `"lopez"` still in the input and the filtered list showing.

2. **Given** the operator sorted `/customers` by `full_name asc` and moved to page 2, **when** they navigate to a detail page and press the browser back button, **then** the listing renders with the same sort and on page 2.

3. **Given** a teammate pastes the URL `/customers?q=lopez&sort=full_name:asc&page=2` in a new browser tab, **when** the page loads, **then** the search input shows `"lopez"`, the column is sorted ascending, and pagination is on page 2.

4. **Given** the operator is at `/commissions?match_status=unmatched` and types `"abc"` in the search box, **when** the debounce fires, **then** the URL becomes `/commissions?match_status=unmatched&q=abc` and both filters apply.

5. **Given** the operator is at `/commissions?match_status=unmatched&q=abc`, **when** they click the `payment_status=pending` badge, **then** the URL preserves `q=abc` alongside the new badge filter.

6. **Given** the operator is on page 3 of `/customers`, **when** they type a new search term, **then** pagination resets to page 1.

7. **Given** the operator is sorting `/customers` by `full_name asc`, **when** they change to page 2, **then** the sort is preserved (page change does not reset sort).

8. **Given** a stray URL `/customers?page=abc&sort=full_name:invalid`, **when** the page loads, **then** pagination is 1 and no sort is applied, with no console errors.

9. **Given** the operator types five characters quickly into the search box, **when** the 250ms debounce elapses, **then** exactly one `router.replace` fires with the final value.

10. **Given** the operator unmounts the listing during a pending debounce, **when** the timer would have fired, **then** no late `router.replace` is invoked.
