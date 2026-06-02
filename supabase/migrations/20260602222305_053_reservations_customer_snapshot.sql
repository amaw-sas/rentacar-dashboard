-- Issue #26: snapshot customer data at booking time.
--
-- reservations links to customer data only through customer_id, so every read path
-- renders the CURRENT customers row — a later UPDATE to a customer (typo fix, merge, or
-- the 2026-05-12 incident bug) silently rewrites the displayed owner of every
-- historical reservation it owns. This migration freezes name/email/phone/identification
-- on each reservation at booking time. Notifications/CRM stay live (they read customers);
-- the snapshot is display/forensic only.
--
-- Strict order: add columns -> backfill -> NOT NULL -> guard trigger -> re-snapshot RPC.
-- The backfill (an UPDATE) MUST run before the guard trigger exists, or the guard would
-- block the initial population.
-- See docs/specs/2026-06-02-issue-26-customer-snapshot-design.md

-- 1. snapshot columns (nullable so the backfill can populate before NOT NULL)
alter table public.reservations
  add column customer_name_at_booking                  text,
  add column customer_email_at_booking                 text,
  add column customer_phone_at_booking                 text,
  add column customer_identification_type_at_booking   text,
  add column customer_identification_number_at_booking text;

-- 2. backfill from the current customers row (runs before the guard trigger exists)
update public.reservations r set
  customer_name_at_booking                  = c.first_name || ' ' || c.last_name,
  customer_email_at_booking                 = c.email,
  customer_phone_at_booking                 = c.phone,
  customer_identification_type_at_booking   = c.identification_type,
  customer_identification_number_at_booking = c.identification_number
from public.customers c
where c.id = r.customer_id;

-- 3. enforce NOT NULL. All source columns are NOT NULL in customers, and customer_id is
--    a NOT NULL FK, so every reservation matches exactly one customers row.
alter table public.reservations
  alter column customer_name_at_booking                  set not null,
  alter column customer_email_at_booking                 set not null,
  alter column customer_phone_at_booking                 set not null,
  alter column customer_identification_type_at_booking   set not null,
  alter column customer_identification_number_at_booking set not null;

-- 4. match-guard. A snapshot column may only CHANGE to a value that matches the current
--    customers row for the reservation's customer_id. This rejects arbitrary drift while
--    allowing the two sanctioned re-snapshots (reassign, inline-contact-edit), which set
--    the snapshot equal to the customer. Updates that don't touch snapshot columns
--    (status changes, normal edits) skip the customers lookup entirely.
create or replace function public.reservations_snapshot_guard()
returns trigger
language plpgsql
as $$
declare
  c public.customers%rowtype;
begin
  if ( new.customer_name_at_booking                  is distinct from old.customer_name_at_booking
    or new.customer_email_at_booking                 is distinct from old.customer_email_at_booking
    or new.customer_phone_at_booking                 is distinct from old.customer_phone_at_booking
    or new.customer_identification_type_at_booking   is distinct from old.customer_identification_type_at_booking
    or new.customer_identification_number_at_booking is distinct from old.customer_identification_number_at_booking )
  then
    select * into c from public.customers where id = new.customer_id;
    if  new.customer_name_at_booking                  is distinct from (c.first_name || ' ' || c.last_name)
     or new.customer_email_at_booking                 is distinct from c.email
     or new.customer_phone_at_booking                 is distinct from c.phone
     or new.customer_identification_type_at_booking   is distinct from c.identification_type
     or new.customer_identification_number_at_booking is distinct from c.identification_number
    then
      raise exception 'reservations snapshot must match the customers row for customer_id (issue #26)';
    end if;
  end if;
  return new;
end;
$$;

create trigger reservations_snapshot_guard
  before update on public.reservations
  for each row execute function public.reservations_snapshot_guard();

-- 5. single-statement re-snapshot RPC. Reads customers and writes the snapshot in ONE
--    statement, so the guard validates against the exact row the UPDATE used (no
--    read/write race, no spurious rejection). SECURITY INVOKER (default): runs under the
--    caller's RLS. Called from updateReservation (reassign) and updateCustomerContact
--    (inline edit).
create or replace function public.resnapshot_reservation(p_id uuid)
returns void
language sql
as $$
  update public.reservations r set
    customer_name_at_booking                  = c.first_name || ' ' || c.last_name,
    customer_email_at_booking                 = c.email,
    customer_phone_at_booking                 = c.phone,
    customer_identification_type_at_booking   = c.identification_type,
    customer_identification_number_at_booking = c.identification_number
  from public.customers c
  where r.id = p_id and c.id = r.customer_id;
$$;
