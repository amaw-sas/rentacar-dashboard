-- Backfill referral_id en public.reservations desde referral_raw.
-- Derives from audit #13 (Q8) and discussion documented in #47.
-- Depends on #46 (seed referrals) — the 5 codes must exist in
-- public.referrals before this migration runs.

-- Lookup canónico: case-insensitive + trimmed.
-- Filtra por referral_id IS NULL para que la migración sea idempotente:
-- re-ejecuciones manuales no re-tocan filas ya backfilleadas.
-- referral_raw queda intacto como audit trail del valor original.

update public.reservations r
set referral_id = ref.id
from public.referrals ref
where r.referral_id is null
  and r.referral_raw is not null
  and lower(trim(r.referral_raw)) = ref.code;
