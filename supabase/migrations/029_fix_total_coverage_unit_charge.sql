-- Fix category_pricing.total_coverage_unit_charge
--
-- Seed values after the Firebase→Supabase migration landed below the basic
-- coverage charge that the localiza availability API returns ($29.000 or
-- $49.000 per day depending on group). The UI then rendered "Seguro Total"
-- cheaper than "Seguro Básico" — a logical impossibility. Operator-confirmed
-- correct per-day values:
--
--   C, CX                   $69.000
--   F, FX, FL, FU           $77.000
--   GC, G4, GL              $99.000
--   LE, GY                  $102.000
--
-- Only active category_pricing rows are updated — those are what the web
-- transformer picks (packages/logic/server/utils/transformers.ts).
--
-- LU is absent from vehicle_categories and is handled in a separate,
-- operator-reviewed migration once the full LU spec is confirmed.
--
-- Idempotent: re-running sets the same values.

update public.category_pricing cp
   set total_coverage_unit_charge = 69000
  from public.vehicle_categories vc
 where cp.category_id = vc.id
   and cp.status = 'active'
   and vc.code in ('C', 'CX');

update public.category_pricing cp
   set total_coverage_unit_charge = 77000
  from public.vehicle_categories vc
 where cp.category_id = vc.id
   and cp.status = 'active'
   and vc.code in ('F', 'FX', 'FL', 'FU');

update public.category_pricing cp
   set total_coverage_unit_charge = 99000
  from public.vehicle_categories vc
 where cp.category_id = vc.id
   and cp.status = 'active'
   and vc.code in ('GC', 'G4', 'GL');

update public.category_pricing cp
   set total_coverage_unit_charge = 102000
  from public.vehicle_categories vc
 where cp.category_id = vc.id
   and cp.status = 'active'
   and vc.code in ('LE', 'GY');
