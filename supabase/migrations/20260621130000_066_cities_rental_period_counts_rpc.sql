-- Analytics → Ciudades: per-city, per-franchise reservation counts for the four
-- dashboard periods (today / yesterday / this week / this month), for BOTH the
-- created (sale origin) and used (recogida / real demand) metrics. Returned in a
-- single call so the report can toggle period and metric client-side without a
-- round trip.
--
-- City comes from the pickup location chain reservations.pickup_location_id →
-- locations.city_id → cities.name (the same chain the reservations list filters
-- by). A NULL city_id (location with no city assigned) collapses to one
-- (NULL, NULL) bucket the UI labels "Sin ciudad".
--
-- Period semantics MIRROR the dashboard (lib/date/bogota + getReservationCounts /
-- getUsedCounts) so the numbers reconcile:
--   created_*  bucket (created_at AT TIME ZONE 'America/Bogota')::date
--     today      = today                used today      = pickup_date = today
--     yesterday  = yesterday            used yesterday  = pickup_date = yesterday
--     week       = Mon..today           used week       = pickup_date Mon..today
--     month      = >= month start       used month      = pickup_date full month
--   used_* additionally require status = 'utilizado' (recogida-based).
-- Week starts Monday, matching bogotaStartOfWeekYMD and date_trunc('week').
--
-- security invoker → respects the caller's RLS (reservations SELECT is
-- `using (true)` for authenticated, like reservation_daily_series #061);
-- search_path pinned for safety. One pass over reservations aggregates with
-- FILTER, so it never ships rows to PostgREST (cf. issue #75).
create or replace function public.cities_rental_period_counts(
  p_franchises text[]
)
returns table (
  city_id uuid,
  city_name text,
  franchise text,
  created_today int,
  created_yesterday int,
  created_week int,
  created_month int,
  used_today int,
  used_yesterday int,
  used_week int,
  used_month int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      (now() at time zone 'America/Bogota')::date as today,
      (now() at time zone 'America/Bogota')::date - 1 as yesterday,
      date_trunc('week', (now() at time zone 'America/Bogota')::date)::date as week_start,
      date_trunc('month', (now() at time zone 'America/Bogota')::date)::date as month_start,
      (date_trunc('month', (now() at time zone 'America/Bogota')::date)
        + interval '1 month - 1 day')::date as month_end
  ),
  base as (
    select
      l.city_id,
      c.name as city_name,
      r.franchise,
      (r.created_at at time zone 'America/Bogota')::date as created_d,
      r.pickup_date as pickup_d,
      r.status
    from public.reservations r
    join public.locations l on l.id = r.pickup_location_id
    left join public.cities c on c.id = l.city_id
    where r.franchise = any(p_franchises)
  )
  select
    b.city_id,
    b.city_name,
    b.franchise,
    count(*) filter (where b.created_d = bo.today)::int,
    count(*) filter (where b.created_d = bo.yesterday)::int,
    count(*) filter (where b.created_d between bo.week_start and bo.today)::int,
    count(*) filter (where b.created_d >= bo.month_start)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d = bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d = bo.yesterday)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.week_start and bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.month_start and bo.month_end)::int
  from base b
  cross join bounds bo
  group by b.city_id, b.city_name, b.franchise
$$;
