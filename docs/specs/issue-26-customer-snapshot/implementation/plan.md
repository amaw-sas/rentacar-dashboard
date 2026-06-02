# Implementation Plan — Issue #26 Customer Snapshot at Booking

**Date**: 2026-06-02
**Spec**: `../2026-06-02-issue-26-customer-snapshot-design.md`
**Scenarios (holdout)**: `../scenarios/customer-snapshot.scenarios.md` (SCEN-001..009)
**Branch**: `feat/issue-26-customer-snapshot`

---

## Chunk 1: File Structure + Steps

### File-level map

| File | New/Mod | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_053_reservations_customer_snapshot.sql` | NEW | 5 snapshot cols, backfill, NOT NULL, `reservations_snapshot_guard` trigger, `resnapshot_reservation(uuid)` RPC. The whole DB contract in one ordered migration. |
| `lib/types/database.ts` | REGEN | `pnpm db:types` after migration applied locally. Never hand-edit. |
| `lib/queries/customers.ts` | MOD | Add `snapshotFromCustomer(supabase, customerId)` + `CustomerSnapshot` type (client injected — boundary rule). |
| `app/api/reservations/route.ts` | MOD | After `findOrCreateCustomer`, snapshot via admin client → spread 5 cols into insert. |
| `lib/actions/reservations.ts` | MOD | `createReservation`: snapshot into insert payload. `updateReservation`: reassign → plain update (no snapshot cols) + `resnapshot_reservation` RPC; unchanged → neither. |
| `lib/actions/customers.ts` | MOD | `updateCustomerContact(id, formData, reservationId?)` → after customer update, call RPC when `reservationId` present. |
| `components/forms/reservation-form.tsx` | MOD | Pass `id` to `updateCustomerContact` when `isEditing`. |
| `lib/queries/dashboard.ts` | MOD | Add `customer_name_at_booking` to `getRecentReservations` explicit select. |
| `app/(dashboard)/page.tsx` | MOD | Render snapshot name in recent reservations (fallback to join). |
| `app/(dashboard)/reservations/columns.tsx` | MOD | Render `*_at_booking ?? customers.*`; extend `ReservationRow` type. |
| `app/(dashboard)/reservations/[id]/page.tsx` | MOD | Render snapshot name. |
| `app/(print)/reservations/[id]/libro/libro.tsx` | MOD | Render snapshot name; extend `LibroReservation` type. |
| `app/(dashboard)/referrals/[id]/page.tsx` | MOD | Build `customer_name` from snapshot. |
| `tests/unit/queries/customers.test.ts` | NEW | `snapshotFromCustomer` mapping (incl. `"first ."`). |
| `tests/unit/actions/reservations.test.ts` | MOD/NEW | `updateReservation` reassign vs no-op branch. |
| `tests/unit/actions/customers.test.ts` | MOD/NEW | `updateCustomerContact` RPC call gated by `reservationId`. |
| `tests/unit/migrations/*` | NEW (optional) | Trigger/RPC behavior on Supabase branch (integration). |

**Decomposition rationale**: DB contract isolated in one migration (atomic, reviewable, rollback-friendly). One snapshot read helper, reused — no duplication across the two write paths. Re-snapshot centralized in the RPC, called from the two sanctioned mutation actions. Display changes split per surface (each independently demoable against SCEN-001). Notifications/CRM/commissions untouched (SCEN-007 is satisfied by absence of change).

### Prerequisites

- Local Supabase running (`supabase start`) for migration apply + `pnpm db:types`.
- Supabase preview branch for integration verification of trigger/RPC/backfill.
- Vercel preview deploy for `/agent-browser` runtime QA.
- Apply migration via MCP `apply_migration` — **never `supabase db push`** (drags unapplied 049/051 drop-markers into prod; memory `issue_23_preconditions_state`).

---

## Implementation Steps

### Phase 1 — Foundation (DB contract)

**Step 1 — Migration 053: columns + backfill + NOT NULL + guard trigger + RPC** | Size: M | Deps: none

Author `<ts>_053_reservations_customer_snapshot.sql` in strict order: (1) ADD 5
nullable columns; (2) backfill from current `customers` (`first_name||' '||last_name`,
email, phone, identification type+number); (3) SET NOT NULL on all 5; (4) create
`reservations_snapshot_guard()` + `BEFORE UPDATE` trigger (value-match guard — rejects
a snapshot change whose new values don't equal the `customers` row for
`NEW.customer_id`); (5) create `resnapshot_reservation(p_id uuid)` SQL RPC (single
statement: `UPDATE reservations r SET ...=c.* FROM customers c WHERE r.id=p_id AND
c.id=r.customer_id`). Apply to a Supabase branch via MCP. Run `pnpm db:types` **after**
NOT NULL is applied locally; rename file to `<timestamp>_053_<name>.sql`.

- **Acceptance**:
  - SCEN-008: every existing row has the 5 columns populated; all NOT NULL.
  - SCEN-006: a direct `UPDATE reservations SET customer_name_at_booking='X'` (non-matching, customer_id unchanged) raises the guard exception on the branch.
  - Guard allows a matching write: `SELECT resnapshot_reservation(id)` succeeds and leaves snapshot = current customer row.
  - Guard skips status-only UPDATE (no snapshot change) — `UPDATE ... SET status='reservado'` succeeds.
  - `lib/types/database.ts` shows the 5 columns as non-null `string` (run db:types after NOT NULL).

### Phase 2 — Write paths (populate at INSERT)

**Step 2 — `snapshotFromCustomer` helper** | Size: S | Deps: Step 1

Add `snapshotFromCustomer(supabase, customerId): Promise<CustomerSnapshot>` to
`lib/queries/customers.ts`: reads the customer row via the **injected** client, returns
the 5 `*_at_booking` fields (`name = first_name + ' ' + last_name`). Never imports
admin (boundary rule). Unit test with mocked client incl. placeholder `"Jose ."`.

- **Acceptance**: helper returns the 5 mapped fields; `"Jose ."` for `last_name='.'`; unit test green.

**Step 3 — Public API insert populates snapshot** | Size: S | Deps: Step 2

In `app/api/reservations/route.ts`, after `findOrCreateCustomer`, call
`snapshotFromCustomer(adminClient, customerId)` and spread the 5 cols into the insert.

- **Acceptance**:
  - SCEN-002: insert persists snapshot = customer row.
  - SCEN-002 variant: CC collision → snapshot = existing customer row, not request body.

**Step 4 — Dashboard `createReservation` populates snapshot** | Size: S | Deps: Step 2

In `lib/actions/reservations.ts` `createReservation`, call
`snapshotFromCustomer(rlsClient, parsed.data.customer_id)` and merge into the insert
payload.

- **Acceptance**: SCEN-003: create persists snapshot from the selected customer.

### Phase 3 — Re-snapshot paths (sanctioned UPDATEs)

**Step 5 — `updateReservation` reassign branch** | Size: M | Deps: Step 1

Read the reservation's current `customer_id` server-side. If the payload changes it:
update the reservation **without** snapshot cols (guard skips, snapshot=OLD), then
`supabase.rpc("resnapshot_reservation", { p_id: id })`. If unchanged: exclude snapshot
cols and skip the RPC. Unit-test both branches (RPC called iff customer_id changed).

- **Acceptance**:
  - SCEN-004: reassign → snapshot becomes new customer's values.
  - SCEN-005: non-customer edit (e.g. pickup_date) → snapshot unchanged, RPC not called, even after an intervening customer mutation.

**Step 6 — Inline contact edit re-snapshots this reservation** | Size: M | Deps: Step 1

Add optional `reservationId` to `updateCustomerContact`; after the customer UPDATE
succeeds and `reservationId` is present, call `resnapshot_reservation(reservationId)`.
In `reservation-form.tsx`, pass `id` at the call site when `isEditing`. Unit-test the
RPC is called iff `reservationId` provided.

- **Acceptance**: SCEN-009: editing X's contact from R's form updates R; X's other reservation stays frozen; no guard rejection.

### Phase 4 — Display reads (render snapshot, fallback to join)

**Step 7 — Reservations list + detail render snapshot** | Size: M | Deps: Step 1

`columns.tsx`: render `customer_name_at_booking ?? fullName(customers)` and the
ID/phone/email `*_at_booking ?? customers.*`; extend `ReservationRow` with optional
`*_at_booking`. `reservations/[id]/page.tsx`: render snapshot name. (Selects use `*` →
columns already returned.)

- **Acceptance**: SCEN-001 (list + detail): after a global customer edit, list and detail still show the booking-time name/ID/phone/email.

**Step 8 — Libro print renders snapshot** | Size: S | Deps: Step 1

`libro.tsx`: render snapshot name; extend `LibroReservation` type.

- **Acceptance**: SCEN-001 (libro): libro shows booking-time name after a global edit.

**Step 9 — Dashboard home recent reservations** | Size: S | Deps: Step 1

`lib/queries/dashboard.ts:getRecentReservations`: add `customer_name_at_booking` to the
explicit select. `app/(dashboard)/page.tsx`: render it (fallback to join).

- **Acceptance**: SCEN-001 (home): recent list shows booking-time name after a global edit.

**Step 10 — Referrals detail reservation list** | Size: S | Deps: Step 1

`app/(dashboard)/referrals/[id]/page.tsx:45`: build `customer_name` from
`customer_name_at_booking ?? customers.*`.

- **Acceptance**: SCEN-001 (referrals): referral's reservation list shows booking-time name after a global edit.

### Phase 5 — Integration verification

**Step 11 — Runtime QA + CI gate + notifications-live confirmation** | Size: M | Deps: Steps 1–10

`/agent-browser` on the Vercel preview: create → snapshot persists; global customer
edit → all 5 display surfaces frozen (SCEN-001); inline contact edit → that reservation
updates (SCEN-009); reassign → display follows new customer (SCEN-004). Confirm
SCEN-007: trigger a resend, verify it targets the **current** email (notifications
unchanged), AND a negative assertion — grep `lib/email/`, `lib/wati/`, `lib/ghl/`, and
`lib/reminders/` to prove no `*_at_booking` reference leaked into recipient resolution.
Run QA **as an admin user** (reassign/inline-edit RPC silently no-op for `employee`
role per RLS — a pre-existing limitation, not this feature; an employee-run QA would
falsely look broken). `/dogfood` exploratory pass: zero console errors, zero failed
requests. Run `/verification-before-completion`; full CI gate (type-check → lint → test
→ build).

- **Acceptance**: all 9 scenarios observably satisfied on preview (as admin); no `*_at_booking` in notification/reminder recipient paths; CI green; zero console/network errors.

---

## Testing Strategy

- **Unit** (vitest, mocked clients): `snapshotFromCustomer` mapping; `updateReservation`
  reassign-vs-no-op branch; `updateCustomerContact` RPC gating. Embedded in Steps 2/5/6.
- **Integration** (Supabase branch): trigger reject/accept boundary (SCEN-006 + matching
  write), RPC single-statement correctness, backfill + NOT NULL (SCEN-008). Step 1.
- **Runtime** (`/agent-browser` on preview): SCEN-001/004/007/009. Step 11.
- **Gate**: CI type-check → lint → test → build, all green (Step 11).

## Rollout Plan

1. Merge PR → migration applies to prod via MCP `apply_migration` (never `db push`).
2. Post-deploy: spot-check a known reservation's display vs a deliberate test-customer
   edit on staging-equivalent data; confirm frozen.
3. **Monitoring**: watch for guard-exception errors in logs (would indicate an
   unexpected snapshot write path) for the first 48h.
4. **Rollback**: the migration is additive (new columns + trigger + RPC). Rollback =
   drop trigger + RPC + columns; no data loss to pre-existing columns. Display code
   falls back to the live `customers` join (kept in selects), so reverting the app code
   alone restores prior behavior without dropping columns.

## Open Questions

None blocking. Residual accepted race (concurrent same-customer global edit during
inline-edit re-snapshot) documented in the spec — benign, not mitigated.
