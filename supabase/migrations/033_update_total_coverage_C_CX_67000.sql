-- Update category_pricing.total_coverage_unit_charge for C and CX: 69000 -> 67000
--
-- Operator-confirmed price adjustment on 2026-04-29. Affects all active
-- pricing rows for C and CX (currently 9 monthly rows each across 2026-04..12,
-- inserted by migration 026 and corrected to 69000 by migration 029).
--
-- Out of scope:
--   * The legacy inactive C row (valid_from 2024-01-15) keeps its historical value.
--   * Other categories (F, FX, FL, FU, GC, G4, GL, LE, GY) are not touched.
--
-- Idempotent: re-running sets the same value with no semantic effect.

update public.category_pricing cp
   set total_coverage_unit_charge = 67000
  from public.vehicle_categories vc
 where cp.category_id = vc.id
   and cp.status = 'active'
   and vc.code in ('C', 'CX')
   and cp.total_coverage_unit_charge <> 67000;
