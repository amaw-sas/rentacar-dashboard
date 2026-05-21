-- Defensa en profundidad: enforce lowercase + trimmed invariant sobre referrals.code.
-- Surge del review de #52 (PR #54) — la normalización app-side en resolveReferral
-- depende de que la DB realmente almacene codes lowercase. Sin esta constraint, un
-- INSERT capitalizado desde admin/MCP/seed quiebra silenciosamente la attribution
-- pipeline (#46 seed, #47 backfill, #52 runtime fix).
--
-- Pre-condición verificada 2026-05-20:
--   select count(*) from public.referrals where code != lower(btrim(code)) → 0.
-- Si en el futuro esa query retorna >0, este ADD CONSTRAINT falla por design;
-- limpiar las filas violadoras primero.

alter table public.referrals
  add constraint referrals_code_lowercase_chk
  check (code = lower(code) and code = btrim(code));
