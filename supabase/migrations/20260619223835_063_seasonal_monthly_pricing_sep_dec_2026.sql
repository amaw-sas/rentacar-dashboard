-- Migration: ensure monthly pricing for 2026-09..12 (issue #173)
--
-- Symptom: monthly plans (30-day rentals) render "agotado" in rentacar-web for
-- pickups from 2026-09-01. The web sources monthly pricing from category_pricing
-- (month_prices) via categoryOffersMonthly/pickPriceForDate, which pick the row
-- by PICKUP DATE. With no active row carrying a positive 1k/2k monthly price for
-- that date, every category is filtered out and shows as unavailable.
--
-- Scope (operator-confirmed 2026-06-19):
--   * Only the 8 gamas that offer monthly: C, CX, F, FX, GC, G4, LE, GY.
--   * FL, FU, GL, LU stay WITHOUT monthly (Libre PYP, per mig. 042) — their
--     single 2026-04..12 NULL row already covers Sep..Dec, so they are untouched.
--   * GR, VP out of scope (not loaded).
--   * Horizon: rest of 2026 only (Sep..Dec). 2027 is a separate task.
--
-- Values: identical to migration 026 (Sep/Nov = LOW, Oct/Dec = HIGH). The
-- total_coverage_unit_charge uses the CURRENT operator-confirmed per-day values
-- (post 029/033), NOT 026's stale seed, so this never regresses those fixes:
--   C, CX        67000  (033)
--   F, FX        77000  (029)
--   GC, G4       99000  (029)
--   LE, GY      102000  (029)
--
-- Idempotent & narrowly scoped: deletes any existing 2026-09..12 rows for these
-- 8 categories, then re-inserts. Safe whatever prod currently holds — creates
-- missing rows, corrects stale ones, or rewrites identical ones. Does not touch
-- August, nor the Libre PYP NULL rows from mig. 042.
--
-- NOTE: this fixes the DATA gap only. Monthly pickups whose 30-day window
-- Localiza rejects (LLNRAG009) still surface as "agotado" until rentacar-web#201
-- (code) is fixed — see #173.

DO $$
DECLARE
  v_localiza_id uuid;
  cat_c uuid; cat_cx uuid; cat_f uuid; cat_fx uuid;
  cat_gc uuid; cat_g4 uuid; cat_le uuid; cat_gy uuid;
BEGIN
  SELECT id INTO v_localiza_id FROM public.rental_companies WHERE code = 'localiza';
  IF v_localiza_id IS NULL THEN
    RAISE EXCEPTION 'Rental company "localiza" not found';
  END IF;

  SELECT id INTO cat_c  FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'C';
  SELECT id INTO cat_cx FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'CX';
  SELECT id INTO cat_f  FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'F';
  SELECT id INTO cat_fx FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'FX';
  SELECT id INTO cat_gc FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'GC';
  SELECT id INTO cat_g4 FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'G4';
  SELECT id INTO cat_le FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'LE';
  SELECT id INTO cat_gy FROM public.vehicle_categories WHERE rental_company_id = v_localiza_id AND code = 'GY';

  IF cat_c IS NULL OR cat_cx IS NULL OR cat_f IS NULL OR cat_fx IS NULL
     OR cat_gc IS NULL OR cat_g4 IS NULL OR cat_le IS NULL OR cat_gy IS NULL THEN
    RAISE EXCEPTION 'One or more monthly categories not found (C, CX, F, FX, GC, G4, LE, GY)';
  END IF;

  -- Idempotent cleanup: only the 2026-09..12 rows of the 8 monthly categories.
  DELETE FROM public.category_pricing
   WHERE category_id IN (cat_c, cat_cx, cat_f, cat_fx, cat_gc, cat_g4, cat_le, cat_gy)
     AND valid_from >= '2026-09-01'
     AND valid_until <= '2026-12-31';

  INSERT INTO public.category_pricing (
    category_id, total_coverage_unit_charge,
    monthly_1k_price, monthly_2k_price, monthly_3k_price,
    monthly_insurance_price, monthly_one_day_price,
    valid_from, valid_until, status
  ) VALUES
    -- ========== SEPTEMBER 2026 (LOW) ==========
    (cat_c,  67000,  3806000,  4252000,  4252000, 476000, 220000, '2026-09-01', '2026-09-30', 'active'),
    (cat_cx, 67000,  4166000,  4613000,  4613000, 476000, 220000, '2026-09-01', '2026-09-30', 'active'),
    (cat_f,  77000,  4527000,  4974000,  4974000, 476000, 250000, '2026-09-01', '2026-09-30', 'active'),
    (cat_fx, 77000,  4676000,  5124000,  5124000, 476000, 300000, '2026-09-01', '2026-09-30', 'active'),
    (cat_gc, 99000,  6017000,  6670000,  6670000, 595000, 550000, '2026-09-01', '2026-09-30', 'active'),
    (cat_g4, 99000,  6544000,  7197000,  7197000, 595000, 550000, '2026-09-01', '2026-09-30', 'active'),
    (cat_le,102000,  7071000,  8435000,  8435000, 595000, 570000, '2026-09-01', '2026-09-30', 'active'),
    (cat_gy,102000, 15471000, 16836000, 16836000, 595000, 550000, '2026-09-01', '2026-09-30', 'active'),

    -- ========== OCTOBER 2026 (HIGH) ==========
    (cat_c,  67000,  4149000,  4635000,  4635000, 476000, 220000, '2026-10-01', '2026-10-31', 'active'),
    (cat_cx, 67000,  4542000,  5029000,  5029000, 476000, 220000, '2026-10-01', '2026-10-31', 'active'),
    (cat_f,  77000,  4935000,  5423000,  5423000, 476000, 250000, '2026-10-01', '2026-10-31', 'active'),
    (cat_fx, 77000,  5097000,  5585000,  5585000, 476000, 300000, '2026-10-01', '2026-10-31', 'active'),
    (cat_gc, 99000,  6560000,  7271000,  7271000, 595000, 550000, '2026-10-01', '2026-10-31', 'active'),
    (cat_g4, 99000,  7134000,  7846000,  7846000, 595000, 550000, '2026-10-01', '2026-10-31', 'active'),
    (cat_le,102000,  7709000,  9196000,  9196000, 595000, 570000, '2026-10-01', '2026-10-31', 'active'),
    (cat_gy,102000, 16864000, 18351000, 18351000, 595000, 550000, '2026-10-01', '2026-10-31', 'active'),

    -- ========== NOVEMBER 2026 (LOW) ==========
    (cat_c,  67000,  3806000,  4252000,  4252000, 476000, 220000, '2026-11-01', '2026-11-30', 'active'),
    (cat_cx, 67000,  4166000,  4613000,  4613000, 476000, 220000, '2026-11-01', '2026-11-30', 'active'),
    (cat_f,  77000,  4527000,  4974000,  4974000, 476000, 250000, '2026-11-01', '2026-11-30', 'active'),
    (cat_fx, 77000,  4676000,  5124000,  5124000, 476000, 300000, '2026-11-01', '2026-11-30', 'active'),
    (cat_gc, 99000,  6017000,  6670000,  6670000, 595000, 550000, '2026-11-01', '2026-11-30', 'active'),
    (cat_g4, 99000,  6544000,  7197000,  7197000, 595000, 550000, '2026-11-01', '2026-11-30', 'active'),
    (cat_le,102000,  7071000,  8435000,  8435000, 595000, 570000, '2026-11-01', '2026-11-30', 'active'),
    (cat_gy,102000, 15471000, 16836000, 16836000, 595000, 550000, '2026-11-01', '2026-11-30', 'active'),

    -- ========== DECEMBER 2026 (HIGH) ==========
    (cat_c,  67000,  4149000,  4635000,  4635000, 476000, 220000, '2026-12-01', '2026-12-31', 'active'),
    (cat_cx, 67000,  4542000,  5029000,  5029000, 476000, 220000, '2026-12-01', '2026-12-31', 'active'),
    (cat_f,  77000,  4935000,  5423000,  5423000, 476000, 250000, '2026-12-01', '2026-12-31', 'active'),
    (cat_fx, 77000,  5097000,  5585000,  5585000, 476000, 300000, '2026-12-01', '2026-12-31', 'active'),
    (cat_gc, 99000,  6560000,  7271000,  7271000, 595000, 550000, '2026-12-01', '2026-12-31', 'active'),
    (cat_g4, 99000,  7134000,  7846000,  7846000, 595000, 550000, '2026-12-01', '2026-12-31', 'active'),
    (cat_le,102000,  7709000,  9196000,  9196000, 595000, 570000, '2026-12-01', '2026-12-31', 'active'),
    (cat_gy,102000, 16864000, 18351000, 18351000, 595000, 550000, '2026-12-01', '2026-12-31', 'active');

  RAISE NOTICE 'Monthly pricing 2026-09..12 ensured: 8 categories x 4 months = 32 rows.';
END $$;
