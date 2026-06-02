-- Issue #28 Ola C: backfill geographic visibility for the categories the web
-- still hardcodes (CX, GY, FU, FL, GL), reusing the existing
-- category_city_visibility schema (migration 014). Reproduces the web's current
-- hardcoded city/branch lists so behavior is unchanged once the web reads it.
-- "Solo Bogotá" (FU/FL/GL) is modeled city-level: the web's 5 hardcoded branch
-- codes are exactly Bogotá's 5 branches (seed), so city=bogota is equivalent
-- (issue #28 open question O1, resolved city-level). Idempotent.

-- Mark the restricted categories. Codes are unique per rental company today;
-- ON CONFLICT on the pivot keeps re-runs safe.
update public.vehicle_categories set visibility_mode = 'restricted'
  where code in ('CX', 'GY', 'FU', 'FL', 'GL');

-- CX: 7 cities.
insert into public.category_city_visibility (category_id, city_id)
select vc.id, c.id
from public.vehicle_categories vc
join public.cities c
  on c.slug in ('barranquilla', 'bogota', 'bucaramanga', 'cali', 'cartagena', 'medellin', 'santa-marta')
where vc.code = 'CX'
on conflict (category_id, city_id) do nothing;

-- GY: the same 7 plus soledad (8 cities).
insert into public.category_city_visibility (category_id, city_id)
select vc.id, c.id
from public.vehicle_categories vc
join public.cities c
  on c.slug in ('barranquilla', 'bogota', 'bucaramanga', 'cali', 'cartagena', 'medellin', 'santa-marta', 'soledad')
where vc.code = 'GY'
on conflict (category_id, city_id) do nothing;

-- FU, FL, GL: Bogotá only.
insert into public.category_city_visibility (category_id, city_id)
select vc.id, c.id
from public.vehicle_categories vc
join public.cities c on c.slug = 'bogota'
where vc.code in ('FU', 'FL', 'GL')
on conflict (category_id, city_id) do nothing;
