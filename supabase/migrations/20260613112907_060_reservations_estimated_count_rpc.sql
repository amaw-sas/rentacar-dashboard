-- Issue #105: growth-gated count strategy for the reservations list.
-- getReservationsPage() reads this estimate to decide between an exact COUNT(*)
-- (< 100k rows) and PostgREST's planned count (>= 100k), so the second full
-- Seq Scan that count:exact adds to every list render only disappears once the
-- table is large enough for it to matter. The estimate is the planner's
-- reltuples statistic — instant, no scan (the whole point: probing the size
-- must not cost what we're trying to save).
--
-- security invoker → no elevated privileges needed: pg_catalog.pg_class is
-- world-readable, and reltuples for a table the caller can already SELECT is
-- not sensitive. search_path pinned to '' for safety, so reservations is
-- schema-qualified at the regclass literal (same convention as #058).
create or replace function public.reservations_estimated_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  -- greatest(..., 0): Postgres stores reltuples = -1 for a never-analyzed table.
  -- Clamp it so the caller's size gate never sees a negative estimate.
  select greatest(reltuples, 0)::bigint
  from pg_catalog.pg_class
  where oid = 'public.reservations'::regclass;
$$;

grant execute on function public.reservations_estimated_count() to authenticated;
