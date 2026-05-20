---
name: seed-referrals
created_by: claude
created_at: 2026-05-20T00:00:00Z
issue: 46
parent_audit: 13
---

# Issue #46 — Seed referrals reales + cleanup test rows

Migración Supabase única que deja `public.referrals` con el universo real de referidos del legacy (Daniela / Diana / Valeria / Carolain Hotel Bondo / SantiagoPremium) y elimina los 2 registros de prueba (`test`, `referidotest`). Habilita los issues subsecuentes #20 (ETL legacy reservations) y #47 (backfill prod actual).

Observable único: estado de la tabla `public.referrals` post-apply, leído por SQL contra Supabase prod. No hay UI ni server actions involucradas en esta migración.

---

## SCEN-001: las 2 filas de prueba ya no existen tras la migración

**Given**: `public.referrals` contiene los registros sembrados manualmente el 2026-04-21 con `code='test'` y `code='referidotest'` (universo: 2 filas test + 0 reales).
**When**: se aplica la migración `<timestamp>_043_seed_referrals.sql` a la base de Supabase prod.
**Then**: `SELECT COUNT(*) FROM public.referrals WHERE code IN ('test', 'referidotest')` retorna `0`.
**Evidence**: salida de `mcp__supabase__execute_sql` ejecutado contra prod post-apply, copiada al artefacto de verificación.

## SCEN-002: cinco referrals reales presentes con atributos exactos

**Given**: migración 043 aplicada.
**When**: se ejecuta `SELECT code, name, type, status FROM public.referrals WHERE code IN ('carolain_hotel_bondo','daniela','diana','santiago_premium','valeria') ORDER BY code`.
**Then**: el resultado contiene exactamente las siguientes 5 filas, en ese orden:

| code                   | name                  | type        | status   |
|------------------------|-----------------------|-------------|----------|
| `carolain_hotel_bondo` | `Carolain Hotel Bondo`| `hotel`     | `active` |
| `daniela`              | `Daniela`             | `salesperson` | `active` |
| `diana`                | `Diana`               | `salesperson` | `active` |
| `santiago_premium`     | `SantiagoPremium`     | `other`     | `active` |
| `valeria`              | `Valeria`             | `salesperson` | `inactive` |

La aserción cubre presencia y atributos exactos de los 5 codes anteriores. Verificación ejecutada inmediatamente post-apply, antes de cualquier inserción legítima de operadores (window TOCTOU acotado al momento de la migración).

**Evidence**: salida tabular de `mcp__supabase__execute_sql` filtrada por los 5 codes esperados, comparada literal contra la tabla anterior.

## SCEN-003: Valeria conserva atribución histórica sin contaminar selects activos

**Given**: estado post-migración.
**When**: se ejecuta `SELECT code FROM public.referrals WHERE status = 'active' ORDER BY code`.
**Then**: el resultado tiene 4 filas — `carolain_hotel_bondo`, `daniela`, `diana`, `santiago_premium`. `valeria` **NO** aparece.

Razón observable: cuando #48 corrija el selector de referido en edición de reserva para filtrar por `status='active'`, Valeria desaparecerá del dropdown, pero las 197 reservas legacy que #47 le asignará (181 directas + 16 vía alias `vale`) conservarán su `referral_id` íntegro para cálculo de comisión histórica.

**Evidence**: salida de `mcp__supabase__execute_sql` listando los 4 codes activos.

## SCEN-004: la migración respeta los CHECK constraints del schema

**Given**: schema declarado en `006_referrals.sql` — `type IN ('company','hotel','salesperson','other')` y `status IN ('active','inactive')`, `code UNIQUE NOT NULL`.
**When**: `mcp__supabase__apply_migration` ejecuta el archivo SQL.
**Then**: la llamada retorna éxito (sin `check constraint violation`, sin `duplicate key value violates unique constraint`).

**Evidence**: respuesta del MCP `apply_migration` sin error; verificable post-hoc con `SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '%_043_seed_referrals'`.

## SCEN-005: RLS y policies no se ven alteradas

**Given**: policies existentes sobre `public.referrals` — 3 definidas en `006_referrals.sql` (authenticated read, admin insert, admin update) + 1 agregada en `016_anon_read_policies.sql` (anon read) = **4 policies** pre-existentes antes de aplicar 043.
**When**: migración 043 aplicada.
**Then**: `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='referrals' ORDER BY policyname` retorna exactamente las 4 policies pre-existentes — sin agregados, sin remociones, sin renames.

Esto es un guardrail: la migración solo toca DATA, no DDL. Si en algún momento del cycle alguien sugiere apagar RLS para insertar y reactivarla, este escenario lo bloquea.

**Evidence**: salida de `pg_policies` query, comparada contra la lista esperada (`Admins can insert referrals`, `Admins can update referrals`, `Anon can read referrals`, `Authenticated users can read referrals`).

---

## Rollback

Plan de reversa si post-apply se descubre un error en attributes (e.g., `type` incorrecto, nombre mal escrito):

1. **Antes de que #47 ejecute backfill**: forward-only migration `044_revert_seed_referrals.sql` con `DELETE FROM public.referrals WHERE code IN (<5 codes>)` + re-INSERT de los 2 test rows preservados en el commit `4ec206c` (UUIDs: `e7731383-793a-4fa4-9a7f-b6182e809700` test, `60f1e3cd-797d-4ee4-8f21-de7b00365d5e` referidotest). Recapturar UUIDs en archivo si la reversa real se ejecuta.
2. **Después de que #47 backfilea**: NO DELETE — el FK `reservations.referral_id` (ON DELETE NO ACTION en `008_reservations.sql:6`) bloqueará la operación de todos modos. Reversa correcta = forward-only `UPDATE` de los atributos incorrectos sobre la fila existente. Mantiene el `referral_id` intacto y preserva atribuciones históricas.
3. **Reversa de filas test**: pre-state snapshot disponible en el commit body de `4ec206c` (resultado del SELECT pre-apply). El re-INSERT de las 2 test rows requiere los UUIDs originales arriba para no romper hipotéticas referencias externas (no había ninguna, pero defensiva).

---

## Fuera de scope (NO son escenarios de esta migración)

- **Backfill de `public.reservations.referral_id`**: vive en #47, requiere SQL aparte que aplique `LOWER(TRIM(referral_raw)) = referrals.code` + alias `vale→valeria` para las 58 reservas prod con `referral_raw` no nulo.
- **ETL legacy reservations**: vive en #20, ejecuta el mismo mapping sobre las 12.967 filas del dump.
- **Ocultar/read-only selector de referido en edición**: vive en #48 (UX anti-fraude).
- **Idempotencia ON CONFLICT**: el rastreador de migraciones de Supabase ya garantiza one-shot; agregar `ON CONFLICT` ocultaría inconsistencias futuras (mismo code con otros atributos), no se incluye intencionalmente.
