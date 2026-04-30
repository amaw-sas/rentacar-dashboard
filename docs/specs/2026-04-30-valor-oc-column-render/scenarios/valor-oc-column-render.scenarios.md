---
name: valor-oc-column-render
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-04-30T00:00:00Z
spec: docs/specs/2026-04-30-valor-oc-column-render-design.md
---

# Scenarios — Valor OC column wiring + detail page formatter alignment

Holdout contract for the change. Write-once after first commit.
Mirrors the "Observable Scenarios" section of the design spec.

---

## SCEN-001: Reservations list "Valor OC" column renders the persisted value as currency
**Given**: a reservation row delivered to `ReservationsTable` whose `total_price_localiza` is `152300`.
**When**: the `valor_oc` column cell is rendered for that row.
**Then**: the cell text equals `currencyFormatter.format(152300)` where `currencyFormatter` is the module-level `Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })` instance defined in `app/(dashboard)/reservations/columns.tsx`.
**Evidence**: vitest test in `tests/unit/components/reservations-columns.test.tsx` invokes the column's accessor + cell against a row with `total_price_localiza = 152300` and asserts the rendered text equals `currencyFormatter.format(152300)` (no hard-coded literal — comparison via the formatter instance to avoid ICU whitespace variance across Node versions).

---

## SCEN-002: Reservations list "Valor OC" column renders zero literally as currency
**Given**: a reservation row whose `total_price_localiza` is `0` (database default for un-edited reservations).
**When**: the `valor_oc` column cell is rendered for that row.
**Then**: the cell text equals `currencyFormatter.format(0)` — NOT a placeholder dash (`—`).
**Evidence**: vitest test asserts the rendered text equals `currencyFormatter.format(0)` and that no instance of the literal string `"—"` appears in the cell output for a row with `total_price_localiza = 0`.

---

## SCEN-003: Edit form changes to Valor OC propagate to the list column on next render
**Given**: an existing reservation displayed in the list with `total_price_localiza = 0`.
**When**: an operator opens the edit form for that reservation, sets the "Valor OC" `MoneyInput` to `200000`, submits, and the list re-renders.
**Then**: the `valor_oc` cell for that row displays `currencyFormatter.format(200000)`.
**Evidence**: covered transitively by SCEN-001 + SCEN-002 (both verify the column reads `total_price_localiza` from the row and applies the formatter). The edit form already persists `total_price_localiza` correctly (pre-existing, unchanged in this work). No separate test added — existing form-submission test coverage in `tests/unit/components/reservation-form.test.tsx` remains valid.

---

## SCEN-004: "Valor OC" column is sortable
**Given**: the reservations table populated with rows whose `total_price_localiza` values span both ascending and descending orders.
**When**: an operator clicks the "Valor OC" column header once, then clicks again.
**Then**: rows reorder ascending after the first click and descending after the second click — the default `@tanstack/react-table` sort behavior for a column with `enableSorting` not set to `false`.
**Evidence**: vitest test asserts the `valor_oc` column definition does NOT contain `enableSorting: false` (the explicit opt-out from the placeholder version is removed). The default tanstack behavior is itself a guarantee of the library — re-asserting it with a render-and-click test is over-engineering for this change.

---

## SCEN-005: Reservation detail page renders all 8 money fields with thousands separators
**Given**: a reservation served to `app/(dashboard)/reservations/[id]/page.tsx` with non-zero values for the 8 money fields: `total_price`, `total_price_to_pay`, `total_price_localiza`, `tax_fee`, `iva_fee`, `coverage_price`, `return_fee`, `extra_hours_price`.
**When**: the detail page renders.
**Then**: each of the 8 corresponding `Field` rows displays the result of `currencyFormatter.format(value)` (Intl.NumberFormat es-CO COP) — none of the raw `$${value}` template literals remain. The `currencyFormatter` instance in `[id]/page.tsx` has the same name and configuration as the one in `columns.tsx`.
**Evidence**: source-diff inspection confirms 8 inline expressions changed across the Precios card (lines 138-142, 144) and the Extras card (lines 154, 156); `grep -n '\\$\\${' app/(dashboard)/reservations/\\[id\\]/page.tsx` returns zero matches in those line ranges after the change. Runtime sanity check via `pnpm dev` + load `/reservations/[some-id]` confirms formatted values in both cards.

---
