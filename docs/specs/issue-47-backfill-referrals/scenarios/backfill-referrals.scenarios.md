---
name: backfill-referrals
created_by: claude
created_at: 2026-05-20T00:00:00Z
issue: 47
parent_audit: 13
depends_on: 46
---

# Issue #47 — Backfill `referral_id` en `public.reservations` desde `referral_raw`

Migración Supabase idempotente que resuelve `referral_id` para las 59 reservas en prod que tienen `referral_raw` poblado pero `referral_id IS NULL` (38 canonical `diana` + 21 canonical `daniela`). Cierra el split-brain de atribución para que la analítica de comisiones pueda usar `referral_id` como clave única tras la migración legacy (#20).

Observable único: estado de `public.reservations` post-backfill, leído por SQL contra Supabase prod. La migración solo modifica el campo `referral_id` (preserva `referral_raw` intacto).

Pre-state confirmado (query 2026-05-20):
- `Diana` raw → canonical `diana` (37 reservas)
- `diana` raw → canonical `diana` (1 reserva)
- `Daniela` raw → canonical `daniela` (21 reservas)
- Total: 59 reservas, todas con `referral_id IS NULL`
- 100% canonical values match codes existentes en `public.referrals` (Diana `9f54c0d3-6545-4ad3-a25b-df67be12f3bc`, Daniela `09cf129b-777c-492a-8e30-ecf29679d0e1`)

---

## SCEN-001: las 21 reservas con `referral_raw='Daniela'` quedan apuntadas al referral Daniela

**Given**: pre-backfill, 21 reservas en `public.reservations` tienen `LOWER(TRIM(referral_raw)) = 'daniela'` y `referral_id IS NULL`; el referral `Daniela` existe en `public.referrals` con `id='09cf129b-777c-492a-8e30-ecf29679d0e1'`.
**When**: la migración 044 se aplica.
**Then**: `SELECT COUNT(*) FROM public.reservations WHERE LOWER(TRIM(referral_raw))='daniela' AND referral_id='09cf129b-777c-492a-8e30-ecf29679d0e1'` retorna `21`.
**Evidence**: salida de `mcp__supabase__execute_sql` post-apply.

## SCEN-002: las 38 reservas con canonical `diana` quedan apuntadas al referral Diana

**Given**: pre-backfill, 38 reservas (37 con raw `Diana` + 1 con raw `diana`) tienen `LOWER(TRIM(referral_raw)) = 'diana'` y `referral_id IS NULL`; el referral `Diana` existe en `public.referrals` con `id='9f54c0d3-6545-4ad3-a25b-df67be12f3bc'`.
**When**: la migración 044 se aplica.
**Then**: `SELECT COUNT(*) FROM public.reservations WHERE LOWER(TRIM(referral_raw))='diana' AND referral_id='9f54c0d3-6545-4ad3-a25b-df67be12f3bc'` retorna `38`.
**Evidence**: salida de `mcp__supabase__execute_sql` post-apply.

## SCEN-003: `referral_raw` se preserva (no se mutan los strings originales)

**Given**: pre-backfill distinct values de `referral_raw` agrupados — `Diana` (37), `diana` (1), `Daniela` (21).
**When**: la migración 044 se aplica.
**Then**: `SELECT referral_raw, COUNT(*) FROM public.reservations WHERE referral_raw IS NOT NULL GROUP BY referral_raw ORDER BY referral_raw` retorna las mismas 3 filas con los mismos counts — `Daniela: 21`, `Diana: 37`, `diana: 1`. Ni `referral_raw` cambia de capitalización ni desaparece ninguno.

Razón: el UPDATE solo modifica `referral_id`. `referral_raw` queda como audit trail del valor original que ingresó el operador desde rentacar-web. Si por convención el equipo decide en el futuro normalizar `referral_raw` también, eso será una migración aparte con su propio SDD.

**Evidence**: salida tabular de `mcp__supabase__execute_sql` con los 3 distinct values y sus counts.

## SCEN-004: el reporte de no-matches retorna vacío post-backfill

**Given**: estado post-backfill.
**When**: se ejecuta `SELECT LOWER(TRIM(referral_raw)) AS canonical, COUNT(*) AS unresolved FROM public.reservations WHERE referral_id IS NULL AND referral_raw IS NOT NULL GROUP BY canonical ORDER BY unresolved DESC`.
**Then**: el resultado tiene `0 filas` — todas las 59 reservas con `referral_raw` poblado fueron resueltas a un `referral_id` válido. Sin remanente para clasificación manual.

Si en el futuro aparece un `referral_raw` no canonicalizable (typo, alias nuevo), esta query retornaría las filas pendientes. Hoy: vacía por construcción del seed #46 (los 5 codes cubren el universo completo de raw values prod).

**Evidence**: salida vacía de `mcp__supabase__execute_sql`.

## SCEN-005: idempotency — re-aplicar el UPDATE no afecta filas

**Given**: estado post-backfill (las 59 reservas ya tienen `referral_id` no-NULL).
**When**: se ejecuta manualmente el mismo UPDATE statement vía `mcp__supabase__execute_sql` (no via `apply_migration` que rechazaría duplicate version).
**Then**: la respuesta indica `0 rows affected` (vía `RETURNING` count o equivalente) — la cláusula `WHERE r.referral_id IS NULL` filtra todas las filas ya backfilleadas. Estado de la tabla idéntico al previo a la re-ejecución.

Esto es un guardrail crítico: la migración tiene que ser segura ante re-ejecución manual (por error de operador, retry de CI, etc.). Sin la cláusula `IS NULL` el UPDATE re-tocaría las 59 filas innecesariamente.

**Evidence**: salida de `execute_sql` con la sentencia `UPDATE ... RETURNING 1` envuelta en `SELECT COUNT(*) FROM (...)` o respuesta del MCP indicando cero rows afectadas.

---

## Fuera de scope (NO son escenarios de esta migración)

- **Alias map `{vale: valeria}`**: no aplica en prod actual (no hay `vale` en `referral_raw`). Solo aplica en ETL legacy #20.
- **Normalización de `referral_raw`**: preservamos el audit trail original. Si en el futuro se decide canonicalizar también `referral_raw`, será migración aparte.
- **UX anti-fraude del selector de referido en edición**: vive en #48.
- **ETL legacy reservations**: vive en #20, aplica el mismo lookup sobre las 12.967 filas del dump tras importarlas.

## Rollback

Plan de reversa si post-apply se descubre un error de atribución (e.g., una reserva específica fue mal asignada por un raw ambiguo):

1. **Reversa global** (si toda la migración fue un error): `UPDATE public.reservations SET referral_id = NULL WHERE referral_id IN (<los 5 referral ids de #46>) AND referral_raw IS NOT NULL`. Idempotente y reversible — `referral_raw` queda intacto, basta re-correr 044 para re-aplicar.
2. **Reversa puntual** (un caso específico): `UPDATE public.reservations SET referral_id = NULL WHERE id = '<reservation-uuid>'`. Re-ejecutar 044 manualmente lo re-resolvería igual; corregir requiere antes ajustar `referral_raw` o el `referrals.code`/`alias`.
3. **Post-#20 (cuando exista historial migrado)**: la reversa global afectaría también las reservas legacy. Reducir el scope al subset de prod actual con `WHERE created_at >= '<pre-#20-cutover-date>'`.
