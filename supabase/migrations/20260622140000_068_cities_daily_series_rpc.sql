-- Analytics → Ciudades, momentum lists: per-city daily counts for the last
-- p_days days, so the report can flag cities trending up/down by comparing a
-- recent window against the prior one (computed client-side from this series).
--
-- One row per (day, city) that had any created or used reservation in the
-- window; days/cities with none simply don't appear and the client treats them
-- as 0. created_count buckets created_at in America/Bogota and used_count uses
-- pickup_date + status='utilizado', matching cities_rental_period_counts (066/
-- 067) and reservation_daily_series (061) so the numbers reconcile.
--
-- The window is computed inside the function from Colombia's "today" so the
-- caller passes only p_days. security invoker + pinned search_path, same stance
-- as the sibling RPCs.
create or replace function public.cities_daily_series(
  p_franchises text[],
  p_days int default 7
)
returns table (
  day date,
  city_id uuid,
  city_name text,
  created_count int,
  used_count int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      (now() at time zone 'America/Bogota')::date as today,
      (now() at time zone 'America/Bogota')::date - (p_days - 1) as from_d
  ),
  base as (
    select
      l.city_id,
      c.name as city_name,
      (r.created_at at time zone 'America/Bogota')::date as created_d,
      r.pickup_date as pickup_d,
      r.status
    from public.reservations r
    join public.locations l on l.id = r.pickup_location_id
    left join public.cities c on c.id = l.city_id
    where r.franchise = any(p_franchises)
  ),
  created as (
    select b.created_d as day, b.city_id, b.city_name, count(*)::int as n
    from base b
    cross join bounds bo
    where b.created_d between bo.from_d and bo.today
    group by 1, 2, 3
  ),
  used as (
    select b.pickup_d as day, b.city_id, b.city_name, count(*)::int as n
    from base b
    cross join bounds bo
    where b.status = 'utilizado' and b.pickup_d between bo.from_d and bo.today
    group by 1, 2, 3
  )
  select
    coalesce(cr.day, us.day) as day,
    coalesce(cr.city_id, us.city_id) as city_id,
    coalesce(cr.city_name, us.city_name) as city_name,
    coalesce(cr.n, 0)::int as created_count,
    coalesce(us.n, 0)::int as used_count
  from created cr
  full outer join used us
    on us.day = cr.day and us.city_id is not distinct from cr.city_id
$$;
