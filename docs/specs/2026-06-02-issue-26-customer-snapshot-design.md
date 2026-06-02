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

- Mutating a customer record never changes the displayed owner of a past reservation.
- Reservations carry a frozen snapshot of customer name, email, phone, and
  identification (type + number) as of the moment they were created.
- The snapshot is enforced read-only at the database level, with one sanctioned
  exception: deliberate reassignment of the reservation to a different customer.

## Non-goals

- **Notifications stay live.** Email / WATI / GHL / pickup reminders keep reading the
  current `customers` row. This is consistent with the decision in #87 / PR #89
  (`lib/email/notifications.ts:189-191`): resend re-renders from current data, not a
  frozen snapshot — so a corrected email/phone propagates on the next send. The
  snapshot serves **display and forensics**, not recipient resolution.
- **CRM / commission attribution stays live.** GHL contact sync and commission queries
  resolve through `customer_id` against current state, by design.
- **No recovery of pre-existing corrupted rows.** Backfill copies current `customers`
  data. Rows already corrupted before this migration inherit the corrupted value.
  Practical impact is ~nil: the known-corrupt test customers (`test90`) were
  hard-deleted 2026-05-14.

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

The snapshot is always built by reading the **`customers` row by `customer_id` at
INSERT time** — never from raw request input.

Rationale: under #25 (lenient `findOrCreateCustomer`, does not mutate on CC
collision), a colliding booking leaves the existing customer record untouched and
`customer_id` points at it. The faithful snapshot is therefore what `customer_id`
resolved to at booking — the customer row — not the submitted-but-discarded values.
Otherwise the snapshot would display values that never matched any customer record.

A single helper centralizes this and is reused by all three write situations:

```ts
// lib/queries/customers.ts (server-only read)
async function snapshotFromCustomer(supabase, customerId): Promise<CustomerSnapshot>
// returns { name, email, phone, identification_type, identification_number }
// keyed to the *_at_booking columns by the caller
```

### Write paths

| Path | File | Today | Change |
|---|---|---|---|
| Public API | `app/api/reservations/route.ts:252` | inserts `customer_id` only | call `snapshotFromCustomer(customerId)` after `findOrCreateCustomer`, spread 5 cols into insert |
| Dashboard create | `lib/actions/reservations.ts:63` | inserts `parsed.data` (has `customer_id`) | same helper before insert, merge into payload |

### Edit path — conditional re-snapshot

`updateReservation` (`lib/actions/reservations.ts:94`) today does not strip
`customer_id`, so an edit can reassign the customer.

- Read the reservation's current `customer_id` server-side.
- If `payload.customer_id !== current.customer_id` → call `snapshotFromCustomer(new)`
  and include the 5 columns in the update. **This is the one sanctioned UPDATE.**
- Otherwise → do **not** include snapshot columns in the payload. The snapshot stays
  frozen even if the customer record mutated in between. This is the anti-corruption
  invariant.

Client-supplied `customer_id` is not trusted; the comparison uses a server read.

### Trigger drift-guard (defense in depth)

The public API uses the admin client, which bypasses RLS — a `BEFORE UPDATE` trigger
is the only real guarantee there.

```sql
CREATE FUNCTION reservations_snapshot_readonly() RETURNS trigger AS $$
BEGIN
  IF (NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id) AND (
        NEW.customer_name_at_booking                  IS DISTINCT FROM OLD.customer_name_at_booking
     OR NEW.customer_email_at_booking                 IS DISTINCT FROM OLD.customer_email_at_booking
     OR NEW.customer_phone_at_booking                 IS DISTINCT FROM OLD.customer_phone_at_booking
     OR NEW.customer_identification_type_at_booking   IS DISTINCT FROM OLD.customer_identification_type_at_booking
     OR NEW.customer_identification_number_at_booking IS DISTINCT FROM OLD.customer_identification_number_at_booking
  ) THEN
    RAISE EXCEPTION 'reservations snapshot columns are read-only unless customer_id changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reservations_snapshot_readonly
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_snapshot_readonly();
```

Allows: INSERT (trigger is UPDATE-only); re-snapshot when `customer_id` changes.
Rejects: any snapshot drift while `customer_id` is unchanged. The trigger does not
validate that the new snapshot *matches* the new customer — the action owns
correctness; the trigger guards against ambient/accidental mutation.

### Read paths — display only

Migrate to render the snapshot (with fallback to the live join for robustness),
keeping the `customers` join for the live-customer profile link:

| File | Renders today | Change |
|---|---|---|
| `app/(dashboard)/reservations/columns.tsx` | `customers.{first_name,last_name,identification_number,phone,email}` | render `*_at_booking ?? customers.*` |
| `app/(dashboard)/reservations/[id]/page.tsx` | `customers.{first_name,last_name}` | render snapshot name |
| `app/(print)/reservations/[id]/libro/libro.tsx` | `customers.{first_name,last_name}` | render snapshot name |
| recent reservations + `lib/queries/dashboard.ts:105` | explicit select `customers(first_name,last_name)` | add `customer_name_at_booking` to select, render it |

`lib/queries/reservations.ts` `RESERVATION_SELECT` / `RESERVATION_LIBRO_SELECT` use
`*`, so the new columns flow through automatically; only the rendering components
change. Notifications, reminders, GHL, commissions: **no change**.

## Backfill

In the same migration, after the trigger is defined (trigger is UPDATE-FOR-EACH-ROW;
backfill is an UPDATE — so define the trigger to allow this initial population, or run
backfill before creating the trigger to avoid the guard; **backfill before trigger**):

```sql
-- 1. add columns (nullable)
-- 2. backfill from current customers
UPDATE reservations r SET
  customer_name_at_booking                  = c.first_name || ' ' || c.last_name,
  customer_email_at_booking                 = c.email,
  customer_phone_at_booking                 = c.phone,
  customer_identification_type_at_booking   = c.identification_type,
  customer_identification_number_at_booking = c.identification_number
FROM customers c WHERE c.id = r.customer_id;
-- 3. SET NOT NULL on all 5 (source cols are NOT NULL in customers; FK guarantees match)
-- 4. CREATE trigger (after backfill, so the UPDATE above is not blocked)
```

## Risks

- **`pnpm db:types`** must regenerate `lib/types/database.ts` after the migration, or
  TypeScript will not see the new columns. Requires a running local Supabase.
- **Type drift in read components**: `ReservationRow` and the libro/detail types must
  add the optional `*_at_booking` fields, or the fallback render won't typecheck.
- **Re-snapshot only on `customer_id` change**: if the edit action accidentally always
  re-snapshots, it re-introduces corruption on every edit. Covered by SCEN-5.
- **Migration ordering**: backfill must run before the trigger is created, else the
  guard blocks the population UPDATE.

## Validation strategy

### Unit tests
- `snapshotFromCustomer` returns the 5 fields mapped from a customer row.
- `updateReservation`: customer_id unchanged → payload excludes snapshot cols;
  customer_id changed → payload includes re-snapshot.

### Integration (Supabase branch)
- Trigger rejects a snapshot-only UPDATE; allows re-snapshot UPDATE; allows INSERT.
- Backfill populates every row; columns NOT NULL afterward.

### Runtime verification (`/agent-browser` on Vercel preview)
- Create reservation → snapshot persisted. Edit customer record → reservation display
  unchanged; customer profile changed. Reassign customer on a reservation → display
  follows new customer.

### CI gate
type-check → lint → test → build, all green.

## Observable scenarios (handoff to /scenario-driven-development)

- **SCEN-1 (anti-corruption, core)**: Given a reservation for customer "Jose", when an
  admin edits that customer to "test90", then the reservation list/detail/libro still
  show "Jose" while the customer profile shows "test90".
- **SCEN-2 (write API)**: Given a `POST /api/reservations`, when inserted, then the 5
  snapshot columns equal the `customers` row resolved by `customer_id` at that moment.
- **SCEN-3 (write dashboard)**: Given `createReservation` with a selected `customer_id`,
  when inserted, then the snapshot columns are populated from that customer.
- **SCEN-4 (re-snapshot)**: Given a reservation whose `customer_id` is changed to
  customer Y via edit, when saved, then the snapshot columns become Y's values.
- **SCEN-5 (no drift)**: Given a reservation edited (e.g. `pickup_date`) without
  changing `customer_id`, when saved, then snapshot columns are unchanged even if the
  customer record was mutated in between.
- **SCEN-6 (trigger guard)**: Given a direct `UPDATE` that changes a snapshot column
  without changing `customer_id`, when executed, then the trigger raises an exception.
- **SCEN-7 (notifications live)**: Given a customer email is corrected and a
  notification is resent, when resend fires, then it goes to the current email, not the
  snapshot.
- **SCEN-8 (backfill)**: Given reservations created before the migration, when backfill
  runs, then every reservation has snapshot columns populated and NOT NULL.
