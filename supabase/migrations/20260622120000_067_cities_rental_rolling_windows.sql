-- Extend cities_rental_period_counts (migration 066) with rolling-window periods.
--
-- Calendar periods (today / yesterday / this week / this month) read as zero
-- early in the day/week — a Monday 12:00 shows 0 for "today" and "this week"
-- even when business is normal. Rolling windows (last 7 / 14 / 30 days) never
-- have that artifact, so the report offers both. The window is inclusive of
-- today: last7 = today-6 .. today, etc. (created bucketed in America/Bogota,
-- used by pickup_date + status='utilizado', same as the calendar periods).
--
-- DROP first because adding OUT columns changes the function's return type, which
-- CREATE OR REPLACE cannot do. Apply BEFORE shipping the report code that reads
-- the new columns; the old code (8 columns) keeps working against the new
-- function (extra columns ignored), so the order is forgiving either way.
drop function if exists public.cities_rental_period_counts(text[]);

create function public.cities_rental_period_counts(
  p_franchises text[]
)
returns table (
  city_id uuid,
  city_name text,
  franchise text,
  created_today int,
  created_yesterday int,
  created_week int,
  created_last7 int,
  created_last14 int,
  created_last30 int,
  created_month int,
  used_today int,
  used_yesterday int,
  used_week int,
  used_last7 int,
  used_last14 int,
  used_last30 int,
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
      (now() at time zone 'America/Bogota')::date - 6 as last7_start,
      (now() at time zone 'America/Bogota')::date - 13 as last14_start,
      (now() at time zone 'America/Bogota')::date - 29 as last30_start,
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
    count(*) filter (where b.created_d between bo.last7_start and bo.today)::int,
    count(*) filter (where b.created_d between bo.last14_start and bo.today)::int,
    count(*) filter (where b.created_d between bo.last30_start and bo.today)::int,
    count(*) filter (where b.created_d >= bo.month_start)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d = bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d = bo.yesterday)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.week_start and bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.last7_start and bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.last14_start and bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.last30_start and bo.today)::int,
    count(*) filter (where b.status = 'utilizado' and b.pickup_d between bo.month_start and bo.month_end)::int
  from base b
  cross join bounds bo
  group by b.city_id, b.city_name, b.franchise;
$$;
