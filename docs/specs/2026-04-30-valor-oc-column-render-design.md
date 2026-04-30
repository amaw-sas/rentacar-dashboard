# Valor OC — Wire Existing Field To Reservations List Column

**Date**: 2026-04-30
**Author**: Pablo Diaz (with Claude)
**Status**: Draft — pending user approval

## Problem

The reservations list shows a column titled **"Valor OC"** but its cell renders a static placeholder dash (`—`). Operators need this column to display the value Localiza pays per reservation so they can compare it against the customer-facing price while the automated commissions module is still in development.

## Discovery

The field already exists end-to-end except for the cell render:

| Layer | State |
|---|---|
| DB column `reservations.total_price_localiza` | Exists since `008_reservations.sql` (`numeric(12,2) not null default 0`) |
| Zod schema `reservationSchema` | Includes `total_price_localiza` with `z.coerce.number().min(0).default(0)` |
| Edit form (`components/forms/reservation-form.tsx:453`) | Renders `<Label>Valor OC</Label>` bound to `total_price_localiza` via `MoneyInput` |
| Detail page (`app/(dashboard)/reservations/[id]/page.tsx:140`) | Displays the value as "Precio Localiza" |
| Query (`lib/queries/reservations.ts:RESERVATION_SELECT`) | Selects `*`, so the field reaches the table data |
| List column (`app/(dashboard)/reservations/columns.tsx:232`) | **Header is "Valor OC"; cell renders a placeholder dash regardless of data** |

The internal name (`total_price_localiza`) is kept for historical compatibility — Localiza is the rentadora the field originated from. The user-facing label "Valor OC" is the operator's term.

## Decision

**Option A** — Wire the existing `total_price_localiza` field to the placeholder column. No DB migration, no schema change, no rename.

Rejected alternatives:
- **Rename to `valor_oc`**: large blast radius (DB migration, type regen, ~10 files, query references) for purely cosmetic alignment between internal and user-facing names. Not justified.
- **New separate `valor_oc` field**: would create duplicate semantics. The existing field already represents what Localiza pays.

## Behavior

- The "Valor OC" column displays `total_price_localiza` formatted as Colombian Peso currency, using the existing `currencyFormatter` instance already shared by the "Total + Tax" column.
- A value of `0` (the database default for un-edited reservations) renders as `$0` — literal to the database, deferred decision per user request. Rationale: until the automated import is live, operators only fill in values they have on hand; visual ambiguity around "$0 vs not yet entered" is acceptable for now.
- Sorting is enabled on the column. Default order is ascending; users can toggle.

## Scope Boundaries

**Changes**:
- `app/(dashboard)/reservations/columns.tsx`
  - Add `total_price_localiza: number` to the `ReservationRow` type.
  - Replace the placeholder `valor_oc` cell with `accessorKey: "total_price_localiza"`, currency-formatted cell, and `enableSorting: true` (default — remove the `enableSorting: false` line).
- `tests/unit/components/reservations-columns.test.tsx`
  - Add coverage asserting the column reads `total_price_localiza` from the row and formats it as currency.

**Out of scope**:
- DB migration / schema changes / rename
- Edit form changes (already works)
- Detail page label rename
- Empty-state placeholder logic (deferred — to revisit when automated commission import lands)
- Multi-row totals / aggregations / filters

## Risks

- **Stale `ReservationRow` shape**: the table is fed via `as unknown as ReservationRow[]` cast in `app/(dashboard)/reservations/page.tsx`. Adding `total_price_localiza: number` to the type does not enforce the underlying query selects it — it doesn't, but it uses `select("*")` so the field is present at runtime. Acceptable; the cast already accepts this risk.
- **Display ambiguity at $0**: explicitly accepted by user; will be reviewed when commissions module ships.

## Observable Scenarios

1. **Renders the persisted value as currency**
   - **Given** a reservation row with `total_price_localiza = 152300`
   - **When** the reservations list page renders
   - **Then** the "Valor OC" cell displays `$ 152.300` (Intl.NumberFormat es-CO, COP)

2. **Renders zero literally**
   - **Given** a reservation row with `total_price_localiza = 0`
   - **When** the reservations list page renders
   - **Then** the "Valor OC" cell displays `$ 0` (no placeholder dash)

3. **Edit form persists changes that flow to the column**
   - **Given** an existing reservation displayed in the list with `total_price_localiza = 0`
   - **When** the operator opens the edit form, sets "Valor OC" to `200000`, and saves
   - **Then** on returning to the list the "Valor OC" column for that row shows `$ 200.000`

4. **Column is sortable**
   - **Given** the reservations table with mixed `total_price_localiza` values
   - **When** the operator clicks the "Valor OC" header
   - **Then** rows reorder ascending, then descending on a second click

## Satisfaction Strategy

- Scenarios 1, 2, 4 are covered by unit tests in `reservations-columns.test.tsx` (no DOM rendering needed beyond what existing tests already exercise).
- Scenario 3 is covered transitively: the form already writes `total_price_localiza`, the column already reads from the row, scenarios 1 and 2 verify the read side. No new e2e needed.
- Verification: `pnpm test`, `pnpm type-check`, `pnpm lint`, then `pnpm dev` + load `/reservations` to confirm the column renders against real Supabase data.
