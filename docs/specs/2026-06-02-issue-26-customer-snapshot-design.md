# Customer data snapshot at booking — design

Issue: #26 (paired with #25, already merged in `88d24ef`)
Date: 2026-06-02
Branch: `feat/issue-26-customer-snapshot`

## Problem

`reservations` links to customer data through `customer_id` only. Every read path
follows that FK and renders the **current** `customers` row. So any `UPDATE` to a
customer — typo fix, duplicate merge, or a bug — silently rewrites the apparent
customer on every historical reservation that customer owns.

This was the proximate cause of the 2026-05-12 incident: JOSE CHIACHIO's booking
notified the correct recipient at booking time, but after the customer record was
mutated to `test90` data, the dashboard showed `test90` on the old reservation. The
email was fine; the historical **display** got corrupted.

`notification_logs` is the only ground truth of who was notified, and it stores just
the resolved `recipient` string (email or phone) — no name, no identification.

## Goals

- Mutating a customer record (from the global Customers section) never changes the
  displayed owner of a past reservation.
- Reservations carry a frozen snapshot of customer name, email, phone, and
  identification (type + number) as of the moment they were created.
- The snapshot is enforced at the database level: it may only be written to values
  that match the customer the reservation points to (sanctioned re-snapshot), never
  drifted to arbitrary values.

## Non-goals

- **Notifications stay live.** Email / WATI / GHL / pickup reminders keep reading the
  current `customers` row. Consistent with #87 / PR #89 (`lib/email/notifications.ts:189-191`):
  resend re-renders from current data, not a frozen snapshot — so a corrected
  email/phone propagates on the next send. The snapshot serves **display and
  forensics**, not recipient resolution.
- **CRM / commission attribution stays live.** GHL contact sync and commission queries
  resolve through `customer_id` against current state, by design.
- **The customer profile page stays live.** `app/(dashboard)/customers/[id]/page.tsx`
  renders the customer record directly (it IS the profile) — unchanged.
- **No recovery of pre-existing corrupted rows.** Backfill copies current `customers`
  data. Rows corrupted before this migration inherit the corrupted value. Practical
  impact ~nil: the known-corrupt test customers (`test90`) were hard-deleted 2026-05-14.

## Architecture

### Snapshot columns (5)

```sql
ALTER TABLE reservations
  ADD COLUMN customer_name_at_booking                  text,
  ADD COLUMN customer_email_at_booking                 text,
  ADD COLUMN customer_phone_at_booking                 text,
  ADD COLUMN customer_identification_type_at_booking   text,
  ADD COLUMN customer_identification_number_at_booking text;
```

- **Name is one column** (`"first last"`). No reservation read path uses `first_name`
  / `last_name` separately — they are always concatenated for display.
- **Identification is two columns** (type + number), faithful to the `customers`
  schema (`identification_type` ∈ CC/CE/NIT/PP/TI, `identification_number`) and to the
  dashboard list, which displays `identification_number`.

### Single snapshot rule

The snapshot is always built by reading the **`customers` row by `customer_id`** —
never from raw request input.

Rationale: under #25 (lenient `findOrCreateCustomer`, does not mutate on CC
collision), a colliding booking leaves the existing customer record untouched and
`customer_id` points at it. The faithful snapshot is therefore what `customer_id`
resolved to — the customer row — not the submitted-but-discarded values. Otherwise the
snapshot would display values that never matched any customer record. (This is exactly
why SCEN-2 includes a CC-collision variant.)

A single helper centralizes this:

```ts
// lib/queries/customers.ts (server-only read)
type CustomerSnapshot = {
  customer_name_at_booking: string;
  customer_email_at_booking: string;
  customer_phone_at_booking: string;
  customer_identification_type_at_booking: string;
  customer_identification_number_at_booking: string;
};
async function snapshotFromCustomer(
  supabase: SupabaseClient,   // caller passes its own correctly-scoped client
  customerId: string
): Promise<CustomerSnapshot>
```

**Client scoping (boundary rule).** The helper takes the Supabase client as a
parameter and never imports one itself. The public API passes the **admin** client;
the dashboard server actions pass the **RLS** client (`createClient()`). The RLS read
relies on the customers SELECT policy (`007_customers.sql:17-20`, readable by any
authenticated user). The helper must NEVER import `lib/supabase/admin` — that would
violate `architecture.md` (admin client is API-route-only).

### Write paths

| Path | File | Today | Change |
|---|---|---|---|
| Public API | `app/api/reservations/route.ts:252` | inserts `customer_id` only | after `findOrCreateCustomer`, `snapshotFromCustomer(admin, customerId)`, spread 5 cols into insert |
| Dashboard create | `lib/actions/reservations.ts:63` | inserts `parsed.data` (has `customer_id`) | `snapshotFromCustomer(rls, customer_id)`, merge into payload before insert |

### Edit path — conditional re-snapshot (reassign)

`updateReservation` (`lib/actions/reservations.ts:94`) today does not strip
`customer_id`, so an edit can reassign the customer.

- Read the reservation's current `customer_id` server-side (do not trust the client).
- If `payload.customer_id !== current.customer_id` → `snapshotFromCustomer(rls, new)`
  and include the 5 columns in the update. **Sanctioned re-snapshot #1.**
- Otherwise → do **not** include snapshot columns in the payload. The snapshot stays
  frozen even if the customer record mutated in between. This is the anti-corruption
  invariant (SCEN-5).

### Inline customer-contact edit — re-snapshot THIS reservation only

`components/forms/reservation-form.tsx:256` (`handleSaveCustomer`) calls
`updateCustomerContact` (`lib/actions/customers.ts:65`), which writes the customer's 6
contact columns from inside the reservation edit screen, with `customer_id` unchanged.

**Decision:** editing contact from a reservation's form is an explicit, deliberate
correction of *that* reservation. So after the customer update succeeds, re-snapshot
**only the current reservation** to the new customer values. The customer's other
reservations stay frozen (protected). UX: what you edit on the screen is what you see.

Implementation: `updateCustomerContact(id, formData, reservationId?)` — when
`reservationId` is provided (edit mode only; create mode has no row yet), after the
customer `UPDATE` the action re-snapshots that single reservation via
`snapshotFromCustomer(rls, id)`. **Sanctioned re-snapshot #2.** `customer_id` is
unchanged here, so the trigger (below) is the mechanism that must allow it — which it
does, because the new snapshot matches the just-updated customer row.

### Trigger — snapshot match-guard (defense in depth)

The original "reject any snapshot change when `customer_id` is unchanged" rule is
**wrong** for this design: inline-edit re-snapshot changes the snapshot with
`customer_id` unchanged. The correct invariant is value-based:

> A snapshot column may only be written to a value that **matches the current
> `customers` row** identified by `NEW.customer_id`.

```sql
CREATE FUNCTION reservations_snapshot_guard() RETURNS trigger AS $$
DECLARE c public.customers%ROWTYPE;
BEGIN
  -- only validate when a snapshot column actually changed (status updates skip this)
  IF ( NEW.customer_name_at_booking                  IS DISTINCT FROM OLD.customer_name_at_booking
    OR NEW.customer_email_at_booking                 IS DISTINCT FROM OLD.customer_email_at_booking
    OR NEW.customer_phone_at_booking                 IS DISTINCT FROM OLD.customer_phone_at_booking
    OR NEW.customer_identification_type_at_booking   IS DISTINCT FROM OLD.customer_identification_type_at_booking
    OR NEW.customer_identification_number_at_booking IS DISTINCT FROM OLD.customer_identification_number_at_booking )
  THEN
    SELECT * INTO c FROM public.customers WHERE id = NEW.customer_id;
    IF  NEW.customer_name_at_booking                  IS DISTINCT FROM (c.first_name || ' ' || c.last_name)
     OR NEW.customer_email_at_booking                 IS DISTINCT FROM c.email
     OR NEW.customer_phone_at_booking                 IS DISTINCT FROM c.phone
     OR NEW.customer_identification_type_at_booking   IS DISTINCT FROM c.identification_type
     OR NEW.customer_identification_number_at_booking IS DISTINCT FROM c.identification_number
    THEN
      RAISE EXCEPTION 'reservations snapshot must match the customers row for customer_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reservations_snapshot_guard
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_snapshot_guard();
```

- **Allows**: reassign re-snapshot (NEW snapshot == customer Y), inline-edit
  re-snapshot (NEW snapshot == just-updated customer X), status/field updates that
  don't touch snapshot (skip the subquery → zero cost).
- **Rejects**: drifting a snapshot to arbitrary values, or to values that no longer
  match the pointed-to customer.
- **Performance**: the `customers` PK lookup runs only when a snapshot column changed
  — rare (reassign + inline-edit). Frequent updates (status changes from
  `check-pending-status.ts:81`, normal edits) skip it.
- **INSERT is not validated** (trigger is `BEFORE UPDATE`, matching the issue's
  "read-only after insert"). Insert correctness is owned by the write-path helper and
  covered by SCEN-2/3. Backfill (an UPDATE) runs **before** the trigger exists, so it
  is never blocked.

### Read paths — display only

Render the snapshot (fallback to the live join for robustness), keeping the
`customers` join for the live-customer profile link:

| File | Renders today | Change |
|---|---|---|
| `app/(dashboard)/reservations/columns.tsx` | `customers.{first_name,last_name,identification_number,phone,email}` | render `*_at_booking ?? customers.*` |
| `app/(dashboard)/reservations/[id]/page.tsx` | `customers.{first_name,last_name}` | render snapshot name |
| `app/(print)/reservations/[id]/libro/libro.tsx` | `customers.{first_name,last_name}` | render snapshot name |
| `app/(dashboard)/page.tsx` (home) via `getRecentReservations` | `customers(first_name,last_name)` | add `customer_name_at_booking` to select (`dashboard.ts:105`), render it |
| `app/(dashboard)/referrals/[id]/page.tsx:45` → `reservation-list.tsx:138` | `customers.{first_name,last_name}` | build `customer_name` from snapshot |

`lib/queries/reservations.ts` `RESERVATION_SELECT` / `RESERVATION_LIBRO_SELECT` use
`*`, so the new columns flow through automatically; only rendering changes.
`getRecentReservations` uses an explicit select and needs the column added. Audit the
reservations sub-list on the customer profile page — it's filtered by `customer_id`
(all rows that customer's), low priority, but render snapshot there too for
consistency if it shows a name. Notifications, reminders, GHL, commissions: **no
change**.

**Type-safety caveat.** `ReservationRow` (`columns.tsx:16-46`) is populated via
`as unknown as ReservationRow[]` (`reservations/page.tsx:35`) and already omits fields
like `nota`. So `tsc` will **not** catch a mistyped/missing `*_at_booking` field in
these force-cast components. Validation of the fallback render relies on runtime
evidence and scenarios (SCEN-1), not the type checker. Still add the optional
`*_at_booking` fields to the row/detail/libro types for documentation and editor help.

## Migration

Filename: `<timestamp>_053_reservations_customer_snapshot.sql` (next number after
`052`; timestamp prefix per `conventions.md` and the MCP `apply_migration` naming rule
in memory). **Strict order — no ambiguity:**

```sql
-- 1. add columns (nullable)
ALTER TABLE reservations ADD COLUMN customer_name_at_booking text, ... (5 cols);

-- 2. backfill from current customers (runs BEFORE the trigger exists, so unblocked)
UPDATE reservations r SET
  customer_name_at_booking                  = c.first_name || ' ' || c.last_name,
  customer_email_at_booking                 = c.email,
  customer_phone_at_booking                 = c.phone,
  customer_identification_type_at_booking   = c.identification_type,
  customer_identification_number_at_booking = c.identification_number
FROM customers c WHERE c.id = r.customer_id;

-- 3. enforce NOT NULL (all 5 source cols are NOT NULL in customers;
--    customer_id is NOT NULL FK → every row matches → no orphan)
ALTER TABLE reservations
  ALTER COLUMN customer_name_at_booking SET NOT NULL, ... (5 cols);

-- 4. create the guard function + trigger (LAST, after backfill)
```

Note: ETL placeholder last names are `'.'` (issue #19 Q1), so backfill yields
`"Jose ."` for those — display-consistent with the existing live concatenation, just
permanently frozen. Not a NULL hazard.

After the migration: **`pnpm db:types`** to regenerate `lib/types/database.ts` (needs
a running local Supabase), or TypeScript won't see the new columns.

## Risks

- `pnpm db:types` not run → compile blind to new columns.
- Inline-edit / reassign accidentally re-snapshots on every edit → re-introduces
  corruption. Guarded by the trigger (snapshot must match customer) + SCEN-5.
- Trigger created before backfill → blocks the population UPDATE. Order above prevents
  this.
- Force-cast types (`as unknown as`) hide field errors → rely on runtime/SCEN-1.

## Validation strategy

### Unit tests
- `snapshotFromCustomer` maps the 5 fields from a customer row (incl. `"first ."`).
- `updateReservation`: customer_id unchanged → payload excludes snapshot; changed →
  payload includes re-snapshot.
- `updateCustomerContact` with `reservationId` → re-snapshots that reservation.

### Integration (Supabase branch)
- Trigger: rejects snapshot drift to non-matching values; allows reassign re-snapshot;
  allows inline-edit re-snapshot (customer_id unchanged, matches updated customer);
  allows status-only UPDATE (no snapshot change). Backfill populates every row;
  NOT NULL holds.

### Runtime verification (`/agent-browser` on Vercel preview)
- Create reservation → snapshot persisted. Edit customer from global Customers section
  → reservation display unchanged; profile changed. Edit contact inline from the
  reservation → that reservation updates. Reassign customer → display follows new
  customer. Referrals detail and dashboard home show frozen names.

### CI gate
type-check → lint → test → build, all green.

## Observable scenarios (handoff to /scenario-driven-development)

- **SCEN-1 (anti-corruption, core)**: Given a reservation for customer "Jose", when an
  admin edits that customer to "test90" **from the global Customers section**, then the
  reservation list, detail, libro, dashboard home, and referrals detail all still show
  "Jose" while the customer profile shows "test90".
- **SCEN-2 (write API + #25 collision)**: Given `POST /api/reservations`, when inserted,
  then the 5 snapshot columns equal the `customers` row resolved by `customer_id`.
  **Variant**: POST with a different submitted name but a colliding
  `identification_number` → snapshot reflects the existing customer row, not the
  submitted body.
- **SCEN-3 (write dashboard)**: Given `createReservation` with a selected `customer_id`,
  when inserted, then snapshot columns are populated from that customer.
- **SCEN-4 (reassign re-snapshot)**: Given a reservation whose `customer_id` is changed
  to customer Y via edit, when saved, then the snapshot columns become Y's values.
- **SCEN-5 (no drift on normal edit)**: Given a reservation edited (e.g. `pickup_date`)
  without changing `customer_id`, when saved, then snapshot columns are unchanged even
  if the customer record was mutated in between.
- **SCEN-6 (trigger guard)**: Given a direct `UPDATE` that sets a snapshot column to a
  value not matching the customer row (customer_id unchanged), when executed, then the
  trigger raises an exception.
- **SCEN-7 (notifications live)**: Given a customer email is corrected and a
  notification is resent, when resend fires, then it goes to the current email, not the
  snapshot.
- **SCEN-8 (backfill)**: Given reservations created before the migration, when backfill
  runs, then every reservation has snapshot columns populated and NOT NULL.
- **SCEN-9 (inline-edit re-snapshot)**: Given reservation R for customer X with two
  reservations, when an operator edits X's contact **from R's form**, then R's display
  updates to the new contact while X's other reservation stays frozen at the old
  contact; the trigger permits R's snapshot write because it matches the updated X.
