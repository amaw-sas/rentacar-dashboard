-- Dashboard trend charts: daily per-franchise series for created & used
-- reservations, so the dashboard renders two line charts without fetching the
-- whole reservations table to bucket in JS (would hit PostgREST's max-rows cap,
-- cf. issue #75) and would ship an O(N) payload on every render.
--
-- created_count buckets by created_at in Colombia time
-- ((created_at at time zone 'America/Bogota')::date), matching lib/date/bogota
-- (UTC-5 fixed) so chart totals reconcile with the dashboard cards.
-- used_count buckets by pickup_date with status='utilizado', mirroring
-- getUsedThisMonth (recogida-based, not creation-based).
--
-- A grid of generate_series(days) × unnest(franchises) left-joined to both
-- aggregations with coalesce(0) guarantees one row per (day, franchise): a day
-- with 0 for a franchise still returns 0, so the line plots a point (continuous
-- line) instead of a gap.
--
-- security invoker → respects the caller's RLS (reservations SELECT is
-- `using (true)` for authenticated, like attribution_breakdown in issue #113);
-- search_path pinned for safety.
create or replace function public.reservation_daily_series(
  p_from date,
  p_to date,
  p_franchises text[]
)
returns table (
  day date,
  franchise text,
  created_count int,
  used_count int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with grid as (
    select d::date as day, f.code as franchise
    from generate_series(p_from, p_to, interval '1 day') as d
    cross join unnest(p_franchises) as f(code)
  ),
  created as (
    select (r.created_at at time zone 'America/Bogota')::date as day,
           r.franchise,
           count(*)::int as n
    from public.reservations r
    where (r.created_at at time zone 'America/Bogota')::date between p_from and p_to
      and r.franchise = any(p_franchises)
    group by 1, 2
  ),
  used as (
    select r.pickup_date as day,
           r.franchise,
           count(*)::int as n
    from public.reservations r
    where r.status = 'utilizado'
      and r.pickup_date between p_from and p_to
      and r.franchise = any(p_franchises)
    group by 1, 2
  )
  select g.day,
         g.franchise,
         coalesce(c.n, 0)::int as created_count,
         coalesce(u.n, 0)::int as used_count
  from grid g
  left join created c on c.day = g.day and c.franchise = g.franchise
  left join used u on u.day = g.day and u.franchise = g.franchise
  order by g.day, g.franchise
$$;
