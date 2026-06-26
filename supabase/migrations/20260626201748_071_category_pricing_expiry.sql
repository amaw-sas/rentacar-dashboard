-- Migration: expire category_pricing rows whose validity window has passed (issue #171)
--
-- Symptom: category_pricing.status='active' never flips to 'inactive' when
-- valid_until passes. Measured 2026-06-19 and again 2026-06-25: 22/82 active rows
-- already expired. rentacar-web reads status='active' directly (transformers.ts
-- season-low fallback; activePricing[0] also supplies the coverage charge), so a
-- stale expired row can win the price/coverage selection. The fix normalizes the
-- DATA, not a dashboard read-path — the real consumer is external.
--
-- Invariant (UNIDIRECTIONAL): status='active' ⟹ vigente. The system only turns a
-- row OFF when its window has passed; it NEVER auto-reactivates. Re-enabling a
-- gama is an explicit ops write (sets status='active' on a still-vigente row).
--
-- "Today" is the Bogota calendar day, (now() AT TIME ZONE 'America/Bogota')::date,
-- NOT current_date (UTC). The operation is Colombian (UTC-5) and rentacar-web
-- defines "today" in Bogota; the cron trigger time (06:00 UTC = 01:00 Bogota) is
-- decoupled from this date logic.
--
-- Three pieces, none of which alone covers both axes (write-time vs time-passage):
--   1. Trigger  — BEFORE INSERT/UPDATE forces inactive when written with a past
--                 valid_until (admin edits, imports).
--   2. pg_cron  — daily job catches rows that expire purely by the clock advancing,
--                 with no write to fire the trigger.
--   3. Backfill — one-time UPDATE normalizing the rows already expired today.
--
-- Operator-confirmed (2026-06-24): the 6 legacy gamas (G, GR, GX, LP, LY, VP,
-- valid_until 2025-12-30) are "sacadas" / not shown, so blanket inactivation is safe.
--
-- Every statement is idempotent: this migration may re-apply over a state that
-- already has it (prod migration-registry drift 063-070).

-- Piece 3 — write-time trigger ---------------------------------------------------

create or replace function public.category_pricing_expire_on_write()
returns trigger
language plpgsql
as $$
begin
  -- Unidirectional: turn OFF an expired row on write; never auto-reactivate.
  if new.valid_until is not null
     and new.valid_until < (now() at time zone 'America/Bogota')::date then
    new.status := 'inactive';
  end if;
  return new;
end;
$$;

-- drop-if-exists before create (a bare create trigger errors on re-apply).
-- Name sorts before 'on_category_pricing_updated' so this BEFORE trigger fires
-- first; benign because they touch disjoint fields (status vs updated_at).
drop trigger if exists category_pricing_set_inactive_on_expiry on public.category_pricing;
create trigger category_pricing_set_inactive_on_expiry
  before insert or update on public.category_pricing
  for each row
  execute function public.category_pricing_expire_on_write();

-- Piece 2 — daily pg_cron job ----------------------------------------------------

-- No `with schema` (lets Supabase place it in pg_catalog), no speculative grants.
create extension if not exists pg_cron;

-- cron.schedule upserts by jobname, so re-apply never duplicates the job.
-- 0 6 * * * = 06:00 UTC daily (= 01:00 Bogota). Schedule time is independent of
-- the Bogota date comparison inside the command.
select cron.schedule(
  'category-pricing-expire-daily',
  '0 6 * * *',
  $job$
    update public.category_pricing
    set status = 'inactive'
    where status = 'active'
      and valid_until is not null
      and valid_until < (now() at time zone 'America/Bogota')::date
  $job$
);

-- Piece 1 — one-time backfill (no-op on re-apply once nothing is expired-active) -

update public.category_pricing
set status = 'inactive'
where status = 'active'
  and valid_until is not null
  and valid_until < (now() at time zone 'America/Bogota')::date;
