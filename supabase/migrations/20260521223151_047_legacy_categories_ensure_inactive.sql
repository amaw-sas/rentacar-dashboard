-- Issue #17 — ensure legacy categories GR/VP/G/LP are inactive for Localiza.
--
-- Premise correction (empirical, 2026-05-21): these 4 codes already exist —
-- defined in supabase/seed.sql and present in prod since 2026-03-30. They are
-- NOT "missing from the destination" as the #13 audit assumed. The real gap is
-- status drift: seed.sql ships GR/LP/VP as 'active' (G as 'inactive'), while
-- prod has all 4 'inactive'. The 390 historical reservations (audit Q9) must
-- resolve their category_code lookup AND these gamas must stay out of the
-- new-reservation selectors (which filter status='active').
--
-- This idempotent upsert:
--   * empty env (e.g. a #22 dry-run branch without seed): INSERTs the 4 inactive
--     with their real prod names AND visibility_mode (LP/VP 'restricted', matching
--     seed) so the two creation paths don't diverge, and ETL #20 lookups resolve.
--   * seeded env: ON CONFLICT flips active GR/LP/VP to inactive, preserving the
--     existing name/description/visibility (only status changes).
--   * prod (already inactive): the DO UPDATE WHERE guard makes it a true no-op.
-- updated_at is owned by the on_vehicle_categories_updated trigger (fires only on
-- a real UPDATE — i.e. an actual flip). Other omitted NOT NULL columns take
-- schema defaults on INSERT.

insert into public.vehicle_categories
  (rental_company_id, code, name, description, status, visibility_mode)
select
  rc.id,
  v.code,
  v.name,
  v.description,
  'inactive',
  v.visibility_mode
from public.rental_companies rc
cross join (values
  ('G',  'Gama G Camioneta Mecánica',              'Camioneta mecánica',             'all'),
  ('GR', 'Gama GR Camioneta Automática 7 puestos', 'Camioneta automática 7 puestos', 'all'),
  ('LP', 'Gama LP Sedán Automático Híbrido',       'Sedán automático híbrido',       'restricted'),
  ('VP', 'Gama VP Camioneta Mecánica de Platón',   'Camioneta mecánica de platón',   'restricted')
) as v(code, name, description, visibility_mode)
where rc.code = 'localiza'
on conflict (rental_company_id, code)
do update set status = 'inactive'
where public.vehicle_categories.status is distinct from 'inactive';
