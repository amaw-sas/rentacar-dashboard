-- Issue #113: server-side aggregation for the Analytics → Origen tab.
-- Returns one row per attribution_channel with its reservation count, so the
-- dashboard never fetches the whole reservations table to compute ~10 numbers.
-- Fetching all rows + counting in JS would hit PostgREST's max-rows cap (the
-- #75 getCustomers truncation lesson) and ship an O(N) payload on every render.
-- All-time, all-franchise — mirrors the Referidos analytics (no period filter).
-- security invoker → respects the caller's RLS (reservations SELECT is
-- `using (true)` for authenticated); search_path pinned for safety.
create or replace function public.attribution_breakdown()
returns table (attribution_channel text, count int)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.attribution_channel, count(*)::int
  from public.reservations r
  group by r.attribution_channel
$$;
