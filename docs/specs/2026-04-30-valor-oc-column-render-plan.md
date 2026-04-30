# Implementation Plan — Valor OC Column Render + Detail Page Formatter

**Date**: 2026-04-30
**Spec**: `docs/specs/2026-04-30-valor-oc-column-render-design.md`
**Scenarios**: `docs/specs/2026-04-30-valor-oc-column-render/scenarios/valor-oc-column-render.scenarios.md`

## Goal

Wire the existing `total_price_localiza` field to the placeholder `valor_oc` column in the reservations list, and align the detail page's 8 money fields with the same `currencyFormatter` so Valor OC and its siblings render with thousands separators.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `app/(dashboard)/reservations/columns.tsx` | Edit | Add `total_price_localiza` to `ReservationRow` type; replace placeholder cell with currency-formatted accessor; remove `enableSorting: false` |
| `app/(dashboard)/reservations/[id]/page.tsx` | Edit | Add module-level `currencyFormatter` constant (same name + config as `columns.tsx`); replace 8 raw `$${value}` template literals with `currencyFormatter.format(...)` |
| `tests/unit/components/reservations-columns.test.tsx` | Edit | Extend existing test file: assert `valor_oc` column accessor reads `total_price_localiza` and cell renders `currencyFormatter.format(...)` for both non-zero and zero values; assert `enableSorting: false` is no longer set |

No new files. No deletes. No DB migration. No schema changes.

## Prerequisites

- pnpm dependencies installed (`pnpm install`)
- Local Supabase or staging dev DB reachable for runtime sanity (Step 5 only)

## Implementation Steps

### Step 1 — Extend `ReservationRow` type and write failing tests for the column

**Size**: S
**Dependencies**: none
**Scenarios driven**: SCEN-001, SCEN-002, SCEN-004

**What to do**:
1. In `tests/unit/components/reservations-columns.test.tsx`, add four test cases (or extend existing ones) under the existing `describe`:
   - `valor_oc` cell renders `currencyFormatter.format(152300)` when `total_price_localiza = 152300` (SCEN-001).
   - `valor_oc` cell renders `currencyFormatter.format(0)` (NOT `"—"`) when `total_price_localiza = 0` (SCEN-002).
   - `valor_oc` cell renders `currencyFormatter.format(152300)` when `total_price_localiza = "152300"` (string) — locks the contract against PostgREST's `numeric(12,2)` string serialization.
   - `valor_oc` column definition does NOT have `enableSorting: false` (SCEN-004).
2. Each test must obtain `currencyFormatter` indirectly — either by importing from the columns module if exported, or by reconstructing the same `Intl.NumberFormat` config inside the test. Hard-coded strings like `"$ 152.300"` are forbidden (whitespace/ICU variance).
3. Add `total_price_localiza: number` to the `ReservationRow` type in `columns.tsx` so the test's row fixtures type-check. The runtime value may be a string (PostgREST quirk) — handled by `Number(...)` at the read site, not by widening the TS type.
4. Add `total_price_localiza` to the `baseRow` fixture in the test file (use `0` so existing tests stay valid).

**Acceptance criteria**:
- `pnpm test tests/unit/components/reservations-columns.test.tsx` runs the new tests.
- The new tests **FAIL** (red) — the cell still renders `—` regardless of input. SCEN-004 also fails because `enableSorting: false` is still present.
- All previously-passing tests in the file still pass.
- `pnpm type-check` passes — adding the field to `ReservationRow` does not break existing consumers (the `as unknown as ReservationRow[]` cast in `page.tsx` accepts the new shape).

**Why "scenarios first" works here**: SCEN-001/002/004 specify the column's contract; the tests encode the contract; the implementation in Step 2 satisfies it. Writing tests against the unimplemented column produces a clean red→green cycle.

---

### Step 2 — Implement the `valor_oc` column cell

**Size**: S
**Dependencies**: Step 1
**Scenarios driven**: SCEN-001, SCEN-002, SCEN-004

**What to do**:
1. In `columns.tsx`, replace the placeholder column definition (lines ~231-236):
   ```ts
   {
     id: "valor_oc",
     header: "Valor OC",
     enableSorting: false,
     cell: () => <span className="text-muted-foreground">—</span>,
   },
   ```
   with:
   ```ts
   {
     id: "valor_oc",
     accessorKey: "total_price_localiza",
     header: "Valor OC",
     cell: ({ getValue }) => currencyFormatter.format(Number(getValue() ?? 0)),
   },
   ```
   `Number(...)` coercion is required: PostgREST returns `numeric(12,2)` columns as strings, which the existing `total_with_tax` accessor (`columns.tsx:227`) already handles the same way. Without this wrap, a string at runtime yields `NaN` and the cell renders `"$ NaN"` despite passing unit tests.
2. Verify `currencyFormatter` is the existing module-level constant at `columns.tsx:73-77` — do not introduce a new instance.

**Acceptance criteria**:
- `pnpm test tests/unit/components/reservations-columns.test.tsx` → new tests **PASS** (green).
- Whole column-test file passes (no regressions).
- `pnpm type-check` passes.
- `pnpm lint` passes — no new warnings or errors.

---

### Step 3 — Add `currencyFormatter` to the detail page

**Size**: S
**Dependencies**: Step 2 (so the formatter pattern is locked in `columns.tsx` first; we copy its config exactly)
**Scenarios driven**: SCEN-005

**What to do**:
1. In `app/(dashboard)/reservations/[id]/page.tsx`, add a module-level constant at the top of the file (after imports, before the `Field` helper):
   ```ts
   const currencyFormatter = new Intl.NumberFormat("es-CO", {
     style: "currency",
     currency: "COP",
     maximumFractionDigits: 0,
   });
   ```
2. Replace the 8 raw template literals — every value must pass through `Number(...)` before the formatter, mirroring the `total_with_tax` accessor pattern at `columns.tsx:227`. PostgREST returns `numeric(12,2)` columns as strings; without the coercion the formatter outputs `"$ NaN"`:
   - Line 138: `Precio Total` → `value={currencyFormatter.format(Number(reservation.total_price ?? 0))}`
   - Line 139: `Total a Pagar` → `value={currencyFormatter.format(Number(reservation.total_price_to_pay ?? 0))}`
   - Line 140: `Precio Localiza` → `value={currencyFormatter.format(Number(reservation.total_price_localiza ?? 0))}`
   - Line 141: `Impuestos` → `value={currencyFormatter.format(Number(reservation.tax_fee ?? 0))}`
   - Line 142: `IVA` → `value={currencyFormatter.format(Number(reservation.iva_fee ?? 0))}`
   - Line 144: `Precio Cobertura` → `value={currencyFormatter.format(Number(reservation.coverage_price ?? 0))}`
   - Line 154: `Cargo Devolución` → `value={currencyFormatter.format(Number(reservation.return_fee ?? 0))}`
   - Line 156: `Precio Horas Extra` → `value={currencyFormatter.format(Number(reservation.extra_hours_price ?? 0))}`
3. Line 143 (`Días Cobertura`) is intentionally excluded — it's `coverage_days`, an integer count, not money.

**Acceptance criteria**:
- `grep -n '\$\${' app/(dashboard)/reservations/\[id\]/page.tsx` returns zero matches in the Precios + Extras card line ranges (138-156). The only `$` characters in those lines come from the formatter output.
- `pnpm type-check` passes.
- `pnpm lint` passes.
- Detail page renders without runtime errors when loaded in Step 5.

---

### Step 4 — Quality integration (parallel agents)

**Size**: S
**Dependencies**: Step 3
**Scenarios driven**: all (cross-cutting review)

**What to do**:
Dispatch in parallel:
- `code-reviewer` — review the diff for correctness, naming, idiom alignment with the codebase
- `code-simplifier` — check for redundancy or over-engineering
- `edge-case-detector` — boundary conditions (negative values? `null`? `NaN`?)
- `performance-engineer` — irrelevant to this scope but invoke for completeness; expected to be a no-op

Apply blocking findings; defer or document non-blocking ones.

**Acceptance criteria**:
- All blocking findings resolved.
- Non-blocking findings either applied or recorded in the spec's "Risks" / "Out of scope" sections.

---

### Step 5 — Runtime sanity check + verification gate

**Size**: S
**Dependencies**: Step 4
**Scenarios driven**: SCEN-001, SCEN-002, SCEN-003, SCEN-005

**What to do**:
1. Run the full verification suite:
   - `pnpm test` (no failures, no skips)
   - `pnpm type-check` (no errors)
   - `pnpm lint` (no errors, no new warnings)
   - `pnpm build` (exit code 0)
2. `pnpm dev` (Turbopack), then:
   - Load `/reservations` — confirm the "Valor OC" column shows formatted currency for at least one row with non-zero value and at least one with zero. SCEN-001, SCEN-002, SCEN-004 manually verified.
   - Click an existing row's edit → change Valor OC → save → return to list. Confirm the new value appears formatted (SCEN-003 transitive verification).
   - Load `/reservations/[some-id]` for that same row — confirm all 8 money fields show thousands separators. SCEN-005 verified.
3. Invoke `/verification-before-completion` skill explicitly to gate the commit/PR.

**Acceptance criteria**:
- All 5 scenarios satisfied (`5/5`) per the verification skill's convergence gate.
- No console errors in the browser during the runtime check.
- No new warnings from `pnpm lint`.
- Reward-hacking check clean (no scenario expectations modified after Step 1).

## Testing Strategy

| Scenario | Verification mechanism |
|---|---|
| SCEN-001 | Vitest in `reservations-columns.test.tsx` (Step 1) |
| SCEN-002 | Vitest in `reservations-columns.test.tsx` (Step 1) |
| SCEN-003 | Transitive (form already writes the field; SCEN-001/002 verify the read side) + manual runtime check (Step 5) |
| SCEN-004 | Vitest assertion that column definition lacks `enableSorting: false` (Step 1) |
| SCEN-005 | Source-diff inspection + manual runtime check (Step 5) — no unit test (no existing render harness for the server-component detail page; introducing one for an 8-line presentation tweak is over-engineering) |

## Rollout Plan

- **Branch**: current branch is `main` (post-merge state). Either continue on `main` and PR to remote main, or cut a short-lived feature branch `feat/valor-oc-column`. Ask the user before pushing.
- **Deploy**: standard Vercel auto-deploy on merge to remote `main`. No env vars, no migrations, no infra changes.
- **Monitoring**: none specific. The change is presentation-only; existing logging/observability covers errors.
- **Rollback**: revert the merge commit. No data migration to undo.

## Risk & Complexity Summary

- **Overall complexity**: S
- **Estimated duration**: 30-60 minutes including verification
- **Risk level**: Low. No data, schema, query, or auth changes. Pure presentation.
- **Highest-risk step**: Step 3 (and Step 2) — PostgREST serializes `numeric(12,2)` as strings, which would silently break the formatter. Mitigated by the prescribed `Number(value ?? 0)` wrap at every read site, mirroring the existing `total_with_tax` accessor pattern at `columns.tsx:227`. The string-input test in Step 1 locks this contract.

## Out of scope (carried from spec)

- DB migration / schema changes / rename
- Edit form changes (already works — `MoneyInput` already formats)
- Detail page label renames
- Empty-state placeholder logic for `0`
- Multi-row totals / aggregations / filters
- Extracting `currencyFormatter` into `lib/format/currency.ts` (defer until a third caller appears)
