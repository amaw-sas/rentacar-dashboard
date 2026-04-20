-- Normalize monthly_mileage legacy values: parseInt('Nk_kms') stored small ints
-- (1/2/3) instead of the canonical trio (1000/2000/3000). Idempotent: only
-- touches rows whose value is in the legacy set.
update public.reservations
   set monthly_mileage = monthly_mileage * 1000
 where monthly_mileage in (1, 2, 3);
