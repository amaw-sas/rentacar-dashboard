# Implementation Plan — DataTable URL state preservation

**Date**: 2026-05-13
**Spec**: `docs/specs/2026-05-13-data-table-url-state-design.md`
**Scenarios**: `docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md`
**Issue**: [#28](https://github.com/amaw-sas/rentacar-dashboard/issues/28)
**Epic**: [#29](https://github.com/amaw-sas/rentacar-dashboard/issues/29)

## Goal

Persist search, sort, and pagination state of the shared `<DataTable />` component into URL search params so that navigating to a detail/edit page and returning preserves the operator's view. Side-fix: ensure `app/(dashboard)/commissions/page.tsx`'s `buildFilterUrl` helper forwards the new URL keys when building server-side badge links so client-side state is not wiped by badge clicks.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `hooks/use-data-table-url-state.ts` | New | URL ↔ react-table state bridge. Reads `useSearchParams()`, returns controlled `state` slots (`columnFilters`, `sorting`, `pagination`) plus `OnChangeFn<T>` setters that write to the URL via `router.replace`. Owns the 20-row `pageSize` default. Debounces `?q=` writes by 250ms. Preserves all foreign `searchParams` keys. |
| `components/data-table/data-table.tsx` | Edit | Replace local `useState` for `sorting` + `columnFilters` and drop `initialState.pagination.pageSize`; consume the hook and forward its state/setters to `useReactTable`. No change to the component's public props. |
| `app/(dashboard)/commissions/page.tsx` | Edit | Extend `buildFilterUrl` so it forwards `q`, `sort`, `page` from the incoming `searchParams` in addition to `import_batch_id` (the helper already preserves). |
| `tests/unit/hooks/use-data-table-url-state.test.ts` | New | Vitest unit tests for the hook covering SCEN-001…010. Uses `vi.useFakeTimers()` for debounce, mocks `next/navigation`'s `useSearchParams`, `usePathname`, `useRouter`. |

No new directories under `app/`, no DB migrations, no schema changes, no changes to consumer pages other than commissions.

## Prerequisites

- pnpm dependencies installed (`pnpm install`).
- No new packages needed — `@tanstack/react-table`, `next/navigation` already in tree.

## Implementation Steps

### Step 1 — Pin scenarios as the holdout contract

**Size**: S
**Dependencies**: none
**Scenarios driven**: all (SCEN-001…010)

**What to do**:
1. Verify `docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md` exists and contains 10 SCEN blocks.
2. Commit the scenarios file (sibling commit to the spec) so subsequent steps treat it as immutable.

**Acceptance criteria**:
- `ls docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md` returns the file.
- `grep -c '^## SCEN-' docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md` returns `10`.
- Git log shows the scenarios committed before any code change.

**Why first**: SDD Iron Law — scenarios precede code. This file is the input contract for every following step.

---

### Step 2 — Skeleton hook + URL parsing tests (red)

**Size**: M
**Dependencies**: Step 1
**Scenarios driven**: SCEN-001 (hydration half), SCEN-002, SCEN-003, SCEN-008

**What to do**:
1. Create `hooks/use-data-table-url-state.ts` exporting a function with the typed signature from the spec. Body returns the default state (no URL reads yet) so the file type-checks but tests fail.
2. Create `tests/unit/hooks/use-data-table-url-state.test.ts`. Mock `next/navigation`:
   ```ts
   vi.mock("next/navigation", () => ({
     useSearchParams: vi.fn(),
     usePathname: vi.fn(() => "/customers"),
     useRouter: vi.fn(() => ({ replace: vi.fn() })),
   }));
   ```
3. Write tests for URL → state hydration:
   - `?sort=full_name:asc&page=2` produces `sorting: [{ id: "full_name", desc: false }]` and `pagination: { pageIndex: 1, pageSize: 20 }` (SCEN-002, SCEN-003).
   - `?page=abc&sort=full_name:invalid&q=` produces default state (`page=1`, no sort, no filter) without throwing (SCEN-008).
   - `?q=lopez` with `searchColumn: "full_name"` produces `columnFilters: [{ id: "full_name", value: "lopez" }]` (SCEN-001 hydration half).

**Acceptance criteria**:
- `pnpm test tests/unit/hooks/use-data-table-url-state.test.ts` runs the new tests.
- All three URL-parsing tests **FAIL** (red) — the skeleton returns defaults regardless of URL.
- `pnpm type-check` passes — the skeleton type-checks even if it doesn't behave.

---

### Step 3 — Implement URL parsing (green for SCEN-002, 003, 008)

**Size**: M
**Dependencies**: Step 2
**Scenarios driven**: SCEN-002, SCEN-003, SCEN-008

**What to do**:
1. In the hook, read `useSearchParams()` and derive the three state pieces:
   - `q` → `columnFilters` (only when `options.searchColumn` is set AND the value is non-empty).
   - `sort=<col>:<dir>` → `sorting: [{ id, desc }]`. Validate `dir ∈ {asc, desc}`; otherwise drop. Column id pattern `[a-z0-9_]+` per the spec — anything outside drops the sort.
   - `page=<N>` → `pageIndex: N - 1` (1-based external, 0-based internal). Coerce non-positive or non-numeric to `1`.
2. Always return `pageSize` from the option (`options.pageSize ?? 20`).
3. Memoize the derived state on `searchParams.toString()` to avoid identity churn that would re-render react-table unnecessarily.

**Acceptance criteria**:
- Three tests from Step 2 **PASS** (green).
- `pnpm type-check` and `pnpm lint` pass with zero new warnings.
- No `console.error` or `console.warn` emitted during the test run (catching accidental Next.js complaints about Suspense).

---

### Step 4 — Setter tests for sort + pagination (red)

**Size**: M
**Dependencies**: Step 3
**Scenarios driven**: SCEN-006, SCEN-007

**What to do**:
1. Extend the test file with setter tests using a mock `router.replace`:
   - SCEN-007: `onPaginationChange({ pageIndex: 1, pageSize: 20 })` while URL has `q=lopez&sort=full_name:asc` writes `/customers?q=lopez&sort=full_name:asc&page=2`. Assert preserved keys.
   - SCEN-006: `onColumnFiltersChange([{ id: "full_name", value: "x" }])` while URL has `page=3` writes `/customers?q=x` (page dropped).
   - Additional: `onSortingChange([{ id: "full_name", desc: false }])` while URL has `page=3&q=lopez` writes `/customers?q=lopez&sort=full_name:asc` (page dropped, q preserved).
2. Use `usePathname()` mocked to `/customers`; assert the first arg to `replace` matches the expected URL string.

**Acceptance criteria**:
- New setter tests **FAIL** — the hook's setters currently don't exist or are no-ops.
- Existing parsing tests from Step 3 still pass.

---

### Step 5 — Implement sort + pagination setters (green for SCEN-006, 007)

**Size**: M
**Dependencies**: Step 4
**Scenarios driven**: SCEN-006, SCEN-007

**What to do**:
1. Build a single internal helper `writeUrl(updates: Partial<{ q, sort, page }>, resetPage: boolean)` that:
   - Clones current `searchParams` into a `URLSearchParams`.
   - For each key in `updates`: if value is `null`/empty, `delete`; else `set`.
   - If `resetPage`, additionally `delete("page")`.
   - Calls `router.replace(`${pathname}?${params.toString()}`, { scroll: false })`. If `params.toString()` is empty, replace with `pathname` alone.
2. `onSortingChange`: serialize the first sort entry as `<id>:<dir>` and call `writeUrl({ sort: serialized }, resetPage: true)`. If sorting cleared, pass `sort: null`.
3. `onPaginationChange`: if `pageIndex === 0`, pass `page: null`; else `page: String(pageIndex + 1)`. `resetPage: false` (page changes do not reset themselves).
4. Each setter accepts the react-table updater function form too (when the new state is a function of the old) — invoke it with the current derived state.

**Acceptance criteria**:
- Setter tests from Step 4 **PASS**.
- All previously-passing tests still pass.
- `pnpm type-check` and `pnpm lint` pass.

---

### Step 6 — Search setter with debounce tests (red)

**Size**: M
**Dependencies**: Step 5
**Scenarios driven**: SCEN-009, SCEN-010

**What to do**:
1. Extend tests with fake timers:
   - SCEN-009: simulate five `onColumnFiltersChange` calls 100ms apart; advance timers past the last call + 250ms; assert `router.replace` was called exactly **once** with the final value.
   - SCEN-010: render the hook via `renderHook`, call the setter, unmount before the 250ms elapses, advance timers, assert `router.replace` was **never** invoked.
2. Use `vi.useFakeTimers()` in a `beforeEach`/`afterEach` block.

**Acceptance criteria**:
- Both debounce tests **FAIL** — current implementation writes synchronously and has no cleanup.

---

### Step 7 — Implement debounced search setter (green for SCEN-001, 009, 010)

**Size**: M
**Dependencies**: Step 6
**Scenarios driven**: SCEN-001 (write half), SCEN-009, SCEN-010

**What to do**:
1. Inside the hook, hold a `useRef<NodeJS.Timeout | null>(null)` for the pending debounce timer.
2. `onColumnFiltersChange`:
   - Compute the next `columnFilters` from updater.
   - Extract the value targeting `options.searchColumn`.
   - Clear any pending timer.
   - Schedule a new `setTimeout(() => writeUrl({ q: value || null }, resetPage: true), options.searchDebounceMs ?? 250)`.
3. `useEffect` cleanup on unmount clears the pending timer.
4. Bonus: also clear the pending timer when `pathname` changes (component still mounted but route changed), to avoid late writes targeting the wrong path.

**Acceptance criteria**:
- All debounce tests **PASS**.
- All previously-passing tests still pass.
- A fresh hydration test for SCEN-001 (full cycle: URL → state → setter → URL) passes.

---

### Step 8 — Foreign-param preservation test + commissions integration (red → green)

**Size**: S
**Dependencies**: Step 7
**Scenarios driven**: SCEN-004, SCEN-005

**What to do**:
1. Extend the hook test: set `useSearchParams` to `match_status=unmatched&q=old`, call the search setter with `"abc"`, advance timers; assert the resulting URL string contains BOTH `match_status=unmatched` AND `q=abc` (SCEN-004). The existing implementation should already pass thanks to the `writeUrl` clone — this is a regression-pin, not new logic.
2. Modify `app/(dashboard)/commissions/page.tsx` `buildFilterUrl` to read `q`, `sort`, `page` from `params` (the awaited `searchParams`) and forward them into the constructed `URLSearchParams` alongside `import_batch_id`. Keep the existing `match_status`/`payment_status` toggle logic.
3. Manual verification: load `/commissions?match_status=unmatched&q=abc`, click the `payment_status=pending` badge; assert the resulting URL is `/commissions?match_status=unmatched&payment_status=pending&q=abc`.

**Acceptance criteria**:
- Hook test for SCEN-004 passes.
- `pnpm type-check` and `pnpm lint` pass after `buildFilterUrl` change.
- SCEN-005 verified via `/agent-browser` (manual; documented in PR description).

---

### Step 9 — Wire the hook into `<DataTable />`

**Size**: S
**Dependencies**: Step 8
**Scenarios driven**: SCEN-001…007 end-to-end at component level

**What to do**:
1. In `components/data-table/data-table.tsx`:
   - Remove `useState<SortingState>([])` and `useState<ColumnFiltersState>([])`.
   - Remove `initialState: { pagination: { pageSize: 20 } }` (the hook owns the default).
   - Call `const url = useDataTableUrlState({ searchColumn });`.
   - Pass `url.sorting`, `url.columnFilters`, `url.pagination` into `state`.
   - Pass `url.onSortingChange`, `url.onColumnFiltersChange`, `url.onPaginationChange` to the corresponding `useReactTable` slots.
2. Keep the `<Input value={…getFilterValue()…} onChange={…setFilterValue(…)}>` shape intact — the input now reads from URL-derived filter state and writes to the URL-backed setter, debounced.

**Acceptance criteria**:
- `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.
- Visual smoke test in dev: load `/customers`, type in search, observe URL update after debounce, no console warnings.

---

### Step 10 — Runtime verification across listings + CI gate

**Size**: M
**Dependencies**: Step 9
**Scenarios driven**: SCEN-001, SCEN-002, SCEN-003, SCEN-004, SCEN-005, SCEN-006, SCEN-007

**What to do**:
1. Start `pnpm dev`.
2. Use `/agent-browser` to verify the seven user-facing scenarios on `/customers` (SCEN-001, 002, 003, 006, 007) and on `/commissions` (SCEN-004, 005). Capture URL strings, search input contents, and console state.
3. Console must be clean: zero errors, zero failed requests, no Next.js Suspense warnings.
4. Final CI dry-run locally: `pnpm type-check && pnpm lint && pnpm test && pnpm build` must all pass.
5. Smoke-test one other listing that exercises `<DataTable />` differently (e.g. `/franchises` — has no `searchColumn` for some columns combinations, ensuring the hook handles `searchColumn=undefined` gracefully).

> Load-bearing note: SCEN-005 has no Vitest backstop (it depends on `buildFilterUrl`'s URL composition observed via the browser). The agent-browser run in this step is the only verification gate for SCEN-005 — do not skip it.

**Acceptance criteria**:
- All five user-facing scenarios pass in browser.
- All four CI commands exit 0.
- Console clean on at least two listings (`/customers` + `/commissions`).
- Final commit on the branch references the spec and scenarios files.

---

## Testing Strategy

- **Unit (vitest)**: `tests/unit/hooks/use-data-table-url-state.test.ts` — covers SCEN-001..010 except SCEN-005 (which is a `buildFilterUrl` integration concern verified at runtime).
- **Manual / agent-browser**: SCEN-001..007 end-to-end on the canonical listings (`/customers` + `/commissions`).
- **CI gate**: `pnpm type-check && pnpm lint && pnpm test && pnpm build`.

The scenarios file is the source of truth — tests reference SCEN numbers in their descriptions so the satisfaction mapping is unambiguous during `/verification-before-completion`.

## Rollout Plan

- Branch: `feat/data-table-url-state` off `main`.
- Single PR linking #28 and #29.
- Reviewers: invoke `/pull-request` skill which fans out to code-reviewer + security-reviewer + edge-case-detector + performance-engineer in parallel.
- Merge strategy: squash (matches recent reservation work pattern).
- Rollback: revert the squash commit. No data migrations, no env vars, no infra changes — the rollback is local to three files.
- Post-merge: leave the related epic #29 open; close #28 only after smoke-test on staging.

## Risk Watch

- **Suspense / static generation**: per the spec, dashboard pages are dynamic. If a build warning surfaces about `useSearchParams` requiring a Suspense boundary, wrap the `<Input>` + `<DataTable>` body in `<Suspense>` inside `DataTable` itself rather than asking 9 consumers to do it.
- **react-table identity churn**: if memoization of the derived state is wrong, the table will re-render on every render. Catch via Vitest assertion that consecutive renders with the same `searchParams` string yield reference-equal state objects.
- **Backward-compat with `commissions`**: a missed key in `buildFilterUrl` is the most likely regression. The runtime check in Step 8 catches it; the unit test in Step 8 backstops it.
