-- Migration: Libre PYP categories (FL, FU, GL, LU) — no monthly rental
-- Source: operator instruction 2026-05-07 + analysis in docs/localiza/tarifas-2026.md
--
-- Localiza/Alquilame does NOT offer monthly rental for "Libre PYP" gamas
-- (suffix L or U: FL, FU, GL, LU). The 026_seasonal_pricing_2026.sql migration
-- incorrectly populated monthly tariffs for FL, FU, GL using values from the
-- supplier price list. LU was missing entirely (created later in
-- 20260505153020_036_localiza_2026_fleet.sql, after 026 had run).
--
-- This migration:
--   1. Deletes the 27 incorrect rows (FL/FU/GL × 9 months) for 2026-04..12.
--   2. Inserts 1 row per Libre PYP category covering the full 2026-04..12
--      range with all monthly_*_price = NULL and total_coverage_unit_charge
--      set to the operator-confirmed values:
--        FL, FU: 77000   (per 029_fix_total_coverage_unit_charge.sql)
--        GL:     99000   (per 029_fix_total_coverage_unit_charge.sql)
--        LU:    102000   (operator-confirmed 2026-05-07 — same as LE base)
--
-- Single-row design rationale: Libre PYP gamas have no seasonal variation
-- because they have no monthly tariff. One row per category spanning the
-- full year is semantically cleaner than 9 identical rows per category.
-- The consumer (rentacar-web transformer) selects pricing by
-- (category_id, current_date BETWEEN valid_from AND valid_until), which
-- works identically with 1 row or 9.
--
-- Idempotent: the DELETE step covers re-execution.

DO $$
DECLARE
  v_localiza_id uuid;
  v_cat_fl uuid;
  v_cat_fu uuid;
  v_cat_gl uuid;
  v_cat_lu uuid;
BEGIN
  SELECT id INTO v_localiza_id FROM public.rental_companies WHERE code = 'localiza';
  IF v_localiza_id IS NULL THEN
    RAISE EXCEPTION 'Rental company "localiza" not found';
  END IF;

  SELECT id INTO v_cat_fl FROM public.vehicle_categories
    WHERE rental_company_id = v_localiza_id AND code = 'FL';
  SELECT id INTO v_cat_fu FROM public.vehicle_categories
    WHERE rental_company_id = v_localiza_id AND code = 'FU';
  SELECT id INTO v_cat_gl FROM public.vehicle_categories
    WHERE rental_company_id = v_localiza_id AND code = 'GL';
  SELECT id INTO v_cat_lu FROM public.vehicle_categories
    WHERE rental_company_id = v_localiza_id AND code = 'LU';

  IF v_cat_fl IS NULL OR v_cat_fu IS NULL OR v_cat_gl IS NULL OR v_cat_lu IS NULL THEN
    RAISE EXCEPTION 'One or more Libre PYP categories not found (FL, FU, GL, LU)';
  END IF;

  -- Step 1: idempotent cleanup of any existing 2026-04..12 rows for Libre PYP gamas.
  DELETE FROM public.category_pricing
   WHERE category_id IN (v_cat_fl, v_cat_fu, v_cat_gl, v_cat_lu)
     AND valid_from >= '2026-04-01'
     AND valid_until <= '2026-12-31';

  -- Step 2: insert one row per Libre PYP category for the full 2026-04..12 range.
  -- All monthly_* fields are NULL — these gamas don't accept monthly bookings.
  INSERT INTO public.category_pricing (
    category_id, total_coverage_unit_charge,
    monthly_1k_price, monthly_2k_price, monthly_3k_price,
    monthly_insurance_price, monthly_one_day_price,
    valid_from, valid_until, status
  ) VALUES
    (v_cat_fl,  77000, NULL, NULL, NULL, NULL, NULL, '2026-04-01', '2026-12-31', 'active'),
    (v_cat_fu,  77000, NULL, NULL, NULL, NULL, NULL, '2026-04-01', '2026-12-31', 'active'),
    (v_cat_gl,  99000, NULL, NULL, NULL, NULL, NULL, '2026-04-01', '2026-12-31', 'active'),
    (v_cat_lu, 102000, NULL, NULL, NULL, NULL, NULL, '2026-04-01', '2026-12-31', 'active');

  RAISE NOTICE 'Libre PYP no-monthly pricing applied: 4 categories (FL, FU, GL, LU) x 1 row each.';
END $$;
