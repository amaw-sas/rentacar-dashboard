-- Seed referrals reales del legacy + cleanup de test rows.
-- Derives from audit #13 (Q8) and discussion documented in #46.
-- Universe: 5 real referrals covering 100% of non-null legacy.reservations.user
-- after applying alias map {'vale' -> 'valeria'} (handled later in ETL #20/#47).

-- 1) Cleanup test rows from initial table seed (2026-04-21).
delete from public.referrals
where code in ('test', 'referidotest');

-- 2) Seed the 5 real referrals. Valeria stays inactive (no longer with the
-- company) — preserves historical attribution for commission calculation
-- without surfacing her in active-only selectors.
insert into public.referrals (code, name, type, status) values
  ('daniela',              'Daniela',              'salesperson', 'active'),
  ('diana',                'Diana',                'salesperson', 'active'),
  ('valeria',              'Valeria',              'salesperson', 'inactive'),
  ('carolain_hotel_bondo', 'Carolain Hotel Bondo', 'hotel',       'active'),
  ('santiago_premium',     'SantiagoPremium',      'other',       'active');
