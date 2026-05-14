---
name: data-table-rsc-loop
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-14T15:00:00Z
spec: docs/specs/2026-05-13-data-table-url-state-design.md
parent_scenarios:
  - docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md
  - docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state-followups.scenarios.md
issue: 28
---

# Scenarios — DataTable URL state: RSC fetch loop hotfix

Production bug surfaced after PR #30 merged: applying any filter on `/customers` (and any other listing using `<DataTable />`) causes an unbounded loop of RSC payload fetches (`?q=value&_rsc=...` repeating without pause).

## Root cause

In App Router, `router.replace(href, { scroll: false })` triggers a soft navigation that fetches the RSC payload — even when the resulting href is identical to the current URL. Combined with react-table's `autoResetPageIndex: true` default (which fires `onPaginationChange((prev) => ({ ...prev, pageIndex: 0 }))` every time the `data` array reference changes), this produces a cycle:

```
filter typed → debounce → router.replace("?q=ana")
   ↓
RSC fetch → server re-runs → new data reference
   ↓
react-table autoResetPageIndex → onPaginationChange({pageIndex: 0})
   ↓
writeUrl("page", null, false) → router.replace("?q=ana") (same URL!)
   ↓
RSC fetch → loop
```

---

## SCEN-017: writeUrl skips router.replace when target URL equals current

**Given**: the operator is on `/customers?q=ana` (no `page` key in URL) and the hook is mounted with `pagination.pageIndex === 0`.
**When**: any code path inside the hook calls `writeUrl("page", null, false)` — for example, react-table's `autoResetPageIndex` calling `onPaginationChange({ pageIndex: 0, pageSize: 20 })` after a data refetch.
**Then**: `router.replace` is NOT called, because the computed target URL is identical to the current URL. No RSC payload fetch occurs.
**Evidence**: vitest test sets URL to `?q=ana`, calls `onPaginationChange({ pageIndex: 0, pageSize: 20 })`, asserts `replaceMock` has zero calls. The hook compares the new query string against the current `paramsKey` and short-circuits when equal.

---

## SCEN-018: DataTable disables react-table's autoResetPageIndex

**Given**: the `<DataTable />` component is configured in controlled-state mode (we pass `pagination` in `state` and handle `onPaginationChange`).
**When**: the parent server component re-runs (e.g. on every `router.replace`-triggered soft-navigation), producing a new `data` array reference.
**Then**: react-table does NOT auto-call `onPaginationChange` to reset pageIndex to 0. The redundant reset path is closed; explicit reset still happens via `writeUrl(..., resetPage: true)` when the user changes filter or sort.
**Evidence**: source-diff inspection of `components/data-table/data-table.tsx` — `useReactTable` config includes `autoResetPageIndex: false`. SCEN-017 is the hook-level backstop in case another react-table internal path calls our handler with a no-op transition.

---

## SCEN-019: filtering a listing produces a single RSC fetch, not a loop

**Given**: the operator is on `/customers` with an empty filter.
**When**: they type `"ana"` and the 250ms search debounce flushes.
**Then**: exactly ONE `router.replace` call is made (writing `?q=ana`), and after the resulting soft-navigation the page stabilizes — no further `router.replace` calls are made spontaneously.
**Evidence**: vitest integration-style test renders the hook through a full mount/re-render cycle, simulates server refetch by re-rendering with a new `data` reference (mimicking what Next.js does on RSC payload fetch), and asserts `replaceMock.mock.calls.length === 1`. This is the user-observable scenario that defines the bug being fixed.
