-- Backfill referral_id en public.reservations desde referral_raw.
-- Derives from audit #13 (Q8) and discussion documented in #47.
-- Depends on #46 (seed referrals) — the 5 codes must exist in
-- public.referrals before this migration runs.

-- Lookup canónico: case-insensitive + trimmed.
-- Filtra por referral_id IS NULL para que la migración sea idempotente:
-- re-ejecuciones manuales no re-tocan filas ya backfilleadas.
-- referral_raw queda intacto como audit trail del valor original.

-- Diseño deliberado: la JOIN NO filtra por ref.status. Esto difiere del
-- runtime `resolveReferral` (lib/api/resolve-references.ts) que sí
-- exige status='active'. La divergencia es intencional — para reservas
-- legacy (ETL #20) con `vale`/`valeria`, queremos resolver a Valeria's
-- referral_id aunque esté inactive, para preservar atribución histórica
-- de comisión. Ver SCEN-003 del seed #46 y la sección Rollback del
-- spec de #47. Hoy en prod no hay `valeria`/`vale` en referral_raw
-- (verificado 2026-05-20), así que el path no se ejercita; la regla
-- aplicará cuando #20 importe las 197 atribuciones a Valeria.

-- Limitación conocida: esta migración parcha el backlog histórico pero
-- NO corrige el root cause de re-accrual. El runtime `resolveReferral`
-- es case-sensitive (`.eq("code", code)`), así que bookings de
-- rentacar-web con `?user=Diana` siguen cayendo a referral_raw con
-- referral_id=NULL. Fix tracked en #52 (one-liner: normalizar
-- input con .trim().toLowerCase() antes del .eq). Sin ese fix, el
-- backlog VA a re-acumularse — monitorear con
-- `SELECT count(*) FROM public.reservations
--    WHERE referral_id IS NULL AND referral_raw IS NOT NULL`.

update public.reservations r
set referral_id = ref.id
from public.referrals ref
where r.referral_id is null
  and r.referral_raw is not null
  and lower(trim(r.referral_raw)) = ref.code;
