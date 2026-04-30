# Valor OC — Wire Existing Field To Reservations List Column

**Date**: 2026-04-30
**Author**: Pablo Diaz (with Claude)
**Status**: Draft — pending user approval

## Problem

Two related defects in how `total_price_localiza` (a.k.a. "Valor OC" — what Localiza pays per reservation) is presented to operators:

1. **List**: the reservations list shows a column titled **"Valor OC"** but its cell renders a static placeholder dash (`—`) regardless of data.
2. **Detail page**: 8 money fields render the raw number with a `$` prefix and no thousands separators (`$152300`), making large values hard to read. They span the **Precios** card (`Precio Total`, `Total a Pagar`, `Precio Localiza`, `Impuestos`, `IVA`, `Precio Cobertura` — lines 138-144) and the **Extras** card (`Cargo Devolución`, `Precio Horas Extra` — lines 154, 156).

Operators need both surfaces to show formatted values so they can compare what Localiza pays against the customer-facing price while the automated commissions module is still in development.

## Discovery

The field already exists end-to-end except for the cell render:

| Layer | State |
|---|---|
| DB column `reservations.total_price_localiza` | Exists since `008_reservations.sql` (`numeric(12,2) not null default 0`) |
| Zod schema `reservationSchema` | Includes `total_price_localiza` with `z.coerce.number().min(0).default(0)` |
| Edit form (`components/forms/reservation-form.tsx:453`) | Renders `<Label>Valor OC</Label>` bound to `total_price_localiza` via `MoneyInput` — `MoneyInput` already formats with `Intl.NumberFormat("es-CO")` so the field shows `152.300` (with thousands separators). No change needed. |
| Detail page (`app/(dashboard)/reservations/[id]/page.tsx`) | **Renders 8 money fields as `$${value}` raw template literals — no thousands separators.** Precios card lines 138-144: `total_price`, `total_price_to_pay`, `total_price_localiza`, `tax_fee`, `iva_fee`, `coverage_price`. Extras card lines 154, 156: `return_fee`, `extra_hours_price`. |
| Query (`lib/queries/reservations.ts:RESERVATION_SELECT`) | Selects `*`, so the field reaches the table data |
| List column (`app/(dashboard)/reservations/columns.tsx:232`) | **Header is "Valor OC"; cell renders a placeholder dash regardless of data** |

The internal name (`total_price_localiza`) is kept for historical compatibility — Localiza is the rentadora the field originated from. The user-facing label "Valor OC" is the operator's term.

## Decision

Wire the existing `total_price_localiza` field to the placeholder column AND replace raw `$${value}` template literals on the detail page with the same `currencyFormatter` used by the list. No DB migration, no schema change, no rename.

Detail-page formatter scope: **all 8 money fields** on the page get the formatter, not just `Precio Localiza`. Rationale: they share the same defect; fixing only one creates an internal visual inconsistency on the page worse than the original problem. Operators read these fields side-by-side in the Precios and Extras cards.

Rejected alternatives:
- **Rename `total_price_localiza` to `valor_oc`**: large blast radius (DB migration, type regen, ~10 files, query references) for purely cosmetic alignment between internal and user-facing names. Not justified.
- **New separate `valor_oc` field**: would create duplicate semantics. The existing field already represents what Localiza pays.
- **Fix only `Precio Localiza` on the detail page**: leaves seven sibling money fields broken in the same way. Strictly literal to the request but worse UX.
- **Fix only the 4 fields whose values are summary-related (`Precio Total`, `Total a Pagar`, `Precio Localiza`, `Impuestos`)**: still leaves `IVA`, `Precio Cobertura`, `Cargo Devolución`, `Precio Horas Extra` reading as `$11978` next to `$152.300` — same internal inconsistency the rationale rejects.

## Behavior

- The "Valor OC" column displays `total_price_localiza` formatted as Colombian Peso currency, using the existing `currencyFormatter` instance already shared by the "Total + Tax" column.
- A value of `0` (the database default for un-edited reservations) renders as `$0` — literal to the database, deferred decision per user request. Rationale: until the automated import is live, operators only fill in values they have on hand; visual ambiguity around "$0 vs not yet entered" is acceptable for now.
- Sorting is enabled on the column; first click sorts ascending, second descending (default `@tanstack/react-table` behavior).
- The detail page renders all 8 money fields via the same `currencyFormatter` (a module-level instance named `currencyFormatter`, identical configuration to the one in `columns.tsx` so a future `lib/format/currency.ts` extraction is a rename-free move). The `$` prefix is supplied by `style: "currency"` and is no longer hard-coded in the template literal. Affected fields:
  - Precios card: `total_price`, `total_price_to_pay`, `total_price_localiza`, `tax_fee`, `iva_fee`, `coverage_price`
  - Extras card: `return_fee`, `extra_hours_price`

## Scope Boundaries

**Changes**:
- `app/(dashboard)/reservations/columns.tsx`
  - Add `total_price_localiza: number` to the `ReservationRow` type.
  - Replace the placeholder `valor_oc` cell with `accessorKey: "total_price_localiza"`, currency-formatted cell, and `enableSorting: true` (default — remove the `enableSorting: false` line).
- `app/(dashboard)/reservations/[id]/page.tsx`
  - Add a module-level `currencyFormatter` constant (same name and config as the one in `columns.tsx`).
  - Replace the 8 raw `$${value}` template literals (lines 138-142, 144, 154, 156) with `currencyFormatter.format(...)`.
  - Planning step must verify the `as unknown as ReservationRow[]` cast site in `app/(dashboard)/reservations/page.tsx` is unaffected (this file does not import `ReservationRow`).
- `tests/unit/components/reservations-columns.test.tsx`
  - Add coverage asserting the column reads `total_price_localiza` from the row and formats it as currency.

**Out of scope**:
- DB migration / schema changes / rename
- Edit form changes (already works — `MoneyInput` already formats with thousands separators)
- Detail page label renames (e.g., changing "Precio Localiza" → "Valor OC" — strictly cosmetic, deferred)
- Empty-state placeholder logic (deferred — to revisit when automated commission import lands)
- Multi-row totals / aggregations / filters
- Extracting the `currencyFormatter` into a shared `lib/format/currency.ts` helper (the formatter is identical in two files now; consolidating is a small refactor that doesn't change behavior. Defer until a third site needs it — YAGNI.)

## Risks

- **Stale `ReservationRow` shape**: the table is fed via `as unknown as ReservationRow[]` cast in `app/(dashboard)/reservations/page.tsx`. Adding `total_price_localiza: number` to the type does not enforce the underlying query selects it — it doesn't, but it uses `select("*")` so the field is present at runtime. Acceptable; the cast already accepts this risk.
- **Display ambiguity at $0**: explicitly accepted by user; will be reviewed when commissions module ships.
- **Formatter duplication**: the detail page will declare its own `currencyFormatter` matching the one in `columns.tsx`. Two sources of truth for the same locale/currency config. If a third site needs it, extract into `lib/format/currency.ts`. Until then, two copies are cheaper than premature abstraction.

## Observable Scenarios

1. **Renders the persisted value as currency**
   - **Given** a reservation row with `total_price_localiza = 152300`
   - **When** the reservations list page renders
   - **Then** the "Valor OC" cell displays the value formatted via the shared `currencyFormatter` (Intl.NumberFormat es-CO, COP) — tests compare with `currencyFormatter.format(152300)` rather than a hard-coded literal to avoid ICU whitespace variance.

2. **Renders zero literally**
   - **Given** a reservation row with `total_price_localiza = 0`
   - **When** the reservations list page renders
   - **Then** the "Valor OC" cell displays the result of `currencyFormatter.format(0)` (not a placeholder dash).

3. **Edit form persists changes that flow to the column**
   - **Given** an existing reservation displayed in the list with `total_price_localiza = 0`
   - **When** the operator opens the edit form, sets "Valor OC" to `200000`, and saves
   - **Then** on returning to the list the "Valor OC" column for that row shows the result of `currencyFormatter.format(200000)`.

4. **Column is sortable**
   - **Given** the reservations table with mixed `total_price_localiza` values
   - **When** the operator clicks the "Valor OC" header
   - **Then** rows reorder ascending, then descending on a second click

5. **Detail page renders all 8 money fields with thousands separators**
   - **Given** a reservation with non-zero values for `total_price`, `total_price_to_pay`, `total_price_localiza`, `tax_fee`, `iva_fee`, `coverage_price`, `return_fee`, `extra_hours_price`
   - **When** the detail page (`/reservations/[id]`) renders
   - **Then** each of the 8 corresponding `Field` rows displays the result of `currencyFormatter.format(value)` (Intl.NumberFormat es-CO COP) — none of the raw `$${value}` template literals remain.

## Satisfaction Strategy

- Scenarios 1, 2, 4 are covered by unit tests in `reservations-columns.test.tsx` (no DOM rendering needed beyond what existing tests already exercise).
- Scenario 3 is covered transitively: the form already writes `total_price_localiza`, the column already reads from the row, scenarios 1 and 2 verify the read side. No new e2e needed.
- Scenario 5 is covered by reading the source diff (8 inline expressions changed across the Precios and Extras cards) plus a runtime sanity check — load `/reservations/[some-id]` in `pnpm dev` and observe formatted values. No unit test added: the detail page is a server component without existing test coverage; introducing a render harness for an 8-line presentation tweak is over-engineering. The runtime check is sufficient.
- Verification: `pnpm test`, `pnpm type-check`, `pnpm lint`, then `pnpm dev` + load `/reservations` (column) and `/reservations/[id]` (detail page) to confirm both surfaces render against real Supabase data.
