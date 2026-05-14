---
name: data-table-url-state-followups
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-13T18:00:00Z
spec: docs/specs/2026-05-13-data-table-url-state-design.md
parent_scenarios: docs/specs/2026-05-13-data-table-url-state/scenarios/data-table-url-state.scenarios.md
issue: 28
---

# Scenarios — DataTable URL state follow-up fixes

These scenarios surfaced during Quality Integration (edge-case-detector run after commit f7bc9b3). The parent scenarios file is write-once and remains untouched; this file extends the holdout with the bugs the original contract missed. Treated as additive holdout — same write-once semantics from first commit.

---

## SCEN-011: search input DOM value tracks typing immediately, not URL state

**Given**: the operator is at `/customers` and the search input is empty.
**When**: they type `"l"`, `"lo"`, `"lop"` in rapid succession (faster than 250ms apart) and immediately read the input's DOM `value` property after each keystroke.
**Then**: the input's DOM value at each read step is `"l"`, then `"lo"`, then `"lop"` — never empty mid-keystroke. The URL (`router.replace` write) only fires after the 250ms idle, but the input renders the user's typed value within the same render cycle as the keystroke.
**Evidence**: vitest test renders the `<DataTable />` component with the hook wired in, fires `userEvent.type(input, "lop")` with no timer advances between keystrokes, asserts `input.value === "lop"` after each keystroke. A parallel assertion confirms `router.replace` was NOT called yet (debounce pending). This invariant must hold even when the hook's URL-derived `columnFilters` is still `[]` because the URL has not flushed.

---

## SCEN-012: sort header click on a camelCase column id writes the URL correctly

**Given**: a hypothetical (or new) `DataTable` consumer with a sortable column whose id is `createdAt` (camelCase — does NOT match `[a-z0-9_]+`).
**When**: the user clicks the column header to sort ascending.
**Then**: the URL becomes `?sort=createdAt:asc` and the column header's sort indicator reflects the asc state. The write is NOT silently dropped just because the id has a capital letter.
**Evidence**: vitest test calls the hook's `onSortingChange([{ id: "createdAt", desc: false }])` and asserts the resulting `router.replace` argument contains `sort=createdAt:asc`. Also covers `id-1` (hyphen) and `amount.usd` (dot). Parse-side validation remains strict (rejects untrusted external URLs); serialize-side trusts react-table's own column ids.

---

## SCEN-013: `?page=1e10` and hex `?page=0x10` are rejected

**Given**: a stray URL `/customers?page=1e10` or `/customers?page=0x10`.
**When**: the page loads.
**Then**: pagination resolves to `pageIndex: 0` (page 1). The values are treated the same as `?page=abc` — sanitized to defaults — because `Number.isInteger(1e10)` is `true` and `Number.isInteger(0x10)` is `true` (numeric coercion masks scientific and hex literals).
**Evidence**: vitest test feeds `?page=1e10` and asserts `pagination.pageIndex === 0`. Repeats for `?page=0x10`, `?page=1e15`, `?page=9007199254740990`. The hook gates with a digit-only regex `/^\d+$/` BEFORE `Number()`.

---

## SCEN-014: pagination round-trips an integer string, never scientific notation

**Given**: the hook's `onPaginationChange` is invoked with `{ pageIndex: 1e21, pageSize: 20 }` (via an updater function or direct call from devtools/tests).
**When**: the resulting URL is written.
**Then**: the `page` key is EITHER (a) omitted entirely if the pageIndex exceeds a defensible cap (`MAX_PAGE = 10_000`), OR (b) serialized as a plain digit string. The URL must NEVER contain `page=1e%2B21` or `page=1e+21`.
**Evidence**: vitest test calls `onPaginationChange({ pageIndex: 1e21, pageSize: 20 })` and asserts the written URL either lacks `page` or matches `page=\d+$`. No scientific-notation encoding in the URL.

---

## SCEN-015: `?sort=col:asc:extra` is rejected (exact arity)

**Given**: a URL `/customers?sort=full_name:asc:dropTable` or `/customers?sort=full_name:asc:`.
**When**: the page loads.
**Then**: `sorting` resolves to `[]` (no sort applied). The hook does NOT silently accept the first two segments while discarding the rest, because that mismatches the serialize-side contract and would let extra arbitrary suffixes pass through.
**Evidence**: vitest test feeds `?sort=full_name:asc:dropTable` and asserts `sorting === []`. Also covers `?sort=full_name:asc:` (trailing colon). Parse logic uses `parts.length !== 2` as the gate.

---

## SCEN-016: badge click during pending debounce preserves the freshly-clicked filter

**Given**: the operator is at `/commissions?match_status=unmatched`, types `"abc"` in the search box (debounce timer started, 250ms not yet elapsed), then immediately clicks the `payment_status=pending` badge before the debounce flushes.
**When**: the page reloads with the new badge URL `/commissions?match_status=unmatched&payment_status=pending`, then the search debounce eventually flushes (within the new render).
**Then**: the final URL contains BOTH `payment_status=pending` AND `q=abc`. The user's badge click is NOT silently overwritten by a stale-closure flush that captured the pre-badge URL snapshot.
**Evidence**: vitest test simulates the sequence with fake timers — schedule a search filter change, then update `useSearchParams` mock to the post-badge URL, then advance timers past 250ms. Assert the resulting `router.replace` call's URL contains `payment_status=pending` AND `q=abc`. The hook reads its `writeUrl` via a ref so the flush uses the latest captured `paramsKey`.
