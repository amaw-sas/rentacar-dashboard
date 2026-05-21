---
name: referrals-code-lowercase-check
created_by: claude
created_at: 2026-05-20T00:00:00Z
issue: 55
related: [46, 47, 52]
---

# Issue #55 — Enforce `referrals.code` lowercase + trimmed invariant via CHECK constraint

Defensa en profundidad para la invariante asumida por PR #54 (fix de #52): la normalización app-side `code.trim().toLowerCase()` en `lib/api/resolve-references.ts:resolveReferral` solo funciona si la DB realmente almacena codes lowercase. Sin esta constraint, un `INSERT` capitalizado desde el dashboard admin, vía MCP, o un seed mal escrito quiebra silenciosamente la attribution pipeline (#46 seed, #47 backfill, #52 runtime fix).

Cambio: `ALTER TABLE public.referrals ADD CONSTRAINT referrals_code_lowercase_chk CHECK (code = lower(code) AND code = btrim(code))`. Rechaza cualquier insert/update con código capitalizado o con padding — error temprano, ruidoso, no normalización silenciosa.

Observable único: comportamiento del schema bajo `INSERT` / `UPDATE` con valores adversariales, verificado vía `mcp__supabase__execute_sql` contra prod tras el apply.

Pre-condición verificada en prod (2026-05-20):
- `select count(*) from public.referrals where code != lower(btrim(code))` → `0`.
- 5/5 codes ya normalizados: `carolain_hotel_bondo`, `daniela`, `diana`, `santiago_premium`, `valeria`.

---

## SCEN-001: insert con code uppercase es rechazado

**Given**: la constraint `referrals_code_lowercase_chk` está activa sobre `public.referrals`.
**When**: se ejecuta `insert into public.referrals (code, name, type) values ('TEST', 'x', 'other')`.
**Then**: Postgres retorna error `23514 check_violation` mencionando `referrals_code_lowercase_chk`. Cero filas insertadas.

Razón observable: el caller que olvidó normalizar recibe error explícito en vez de corromper la tabla. La condición `code = lower(code)` falla porque `'TEST' != 'test'`.

**Evidence**: salida de `mcp__supabase__execute_sql` con error 23514.

## SCEN-002: insert con code padding (whitespace) es rechazado

**Given**: mismo estado.
**When**: se ejecuta `insert into public.referrals (code, name, type) values (' test ', 'x', 'other')`.
**Then**: error `23514 check_violation`. Cero filas insertadas.

Razón observable: la condición `code = btrim(code)` falla porque `' test ' != 'test'`. Padding leading/trailing es un vector real (paste accidental, copy desde Excel).

**Evidence**: salida de `mcp__supabase__execute_sql` con error 23514.

## SCEN-003: insert con code válido (lowercase + sin padding) pasa

**Given**: mismo estado.
**When**: se ejecuta `insert into public.referrals (code, name, type) values ('test_constraint_check', 'x', 'other') returning id`.
**Then**: la fila se inserta exitosamente y `returning id` devuelve un UUID. Cleanup post-test: `delete from public.referrals where code='test_constraint_check'` afecta 1 fila.

Razón observable: confirma que la constraint no es un kill-switch sobre todos los inserts — el happy path sigue funcionando.

**Evidence**: salida de `mcp__supabase__execute_sql` con el UUID retornado + delete count.

## SCEN-004: update que reintroduce uppercase es rechazado

**Given**: la fila `code='daniela'` existe (seedeada por #46).
**When**: se ejecuta `update public.referrals set code='Daniela' where code='daniela'`.
**Then**: error `23514 check_violation`. La fila permanece con `code='daniela'`.

Razón observable: la constraint corre en UPDATE además de INSERT. Sin esto, un admin podría editar `code` post-creación y romper la invariante por bypass.

**Evidence**: salida de `mcp__supabase__execute_sql` con error 23514 + verificación `select code from public.referrals where name='Daniela'` retorna `'daniela'`.

## SCEN-005: las 5 filas reales sobreviven el ADD CONSTRAINT

**Given**: pre-apply, `public.referrals` contiene exactamente 5 filas con codes `carolain_hotel_bondo`, `daniela`, `diana`, `santiago_premium`, `valeria` (todas ya normalizadas — verificado 2026-05-20).
**When**: la migración `045_referrals_code_lowercase_check.sql` se aplica.
**Then**: el `ALTER TABLE ... ADD CONSTRAINT` completa sin error. `select code from public.referrals order by code` retorna las mismas 5 filas en el mismo orden, codes idénticos.

Razón observable: si por error existiera una fila con `code != lower(btrim(code))`, el `ADD CONSTRAINT` abortaría toda la migración (Postgres valida data existente al crear CHECK constraint). El éxito de la migración es prueba implícita de la pre-condición.

**Evidence**: salida tabular de `mcp__supabase__execute_sql` con las 5 filas, comparable al pre-state.

---

## Fuera de scope (NO son escenarios de esta migración)

- **Constraint similar en `name` / `notes` / etc.** — `code` es la única columna usada como lookup key (`.eq("code", ...)` en `lib/api/resolve-references.ts:113`). El resto son display strings; mantener su capitalización original es feature, no bug.
- **`UNIQUE(lower(code))` expresión** — innecesario: la CHECK garantiza `code = lower(code)`, así que el `UNIQUE(code)` existente (006_referrals.sql:3) es de facto case-insensitive bajo la constraint.
- **Trigger normalizador (Opción B/C del issue)** — rechazado en favor de errores ruidosos. El silent rewrite esconde la intención del caller (memoria `feedback_findorcreate_no_mutate.md` aplica el mismo principio en otro contexto: nunca mutar silenciosamente input del usuario).
- **Validation client-side en el form admin de referrals** — fuera de scope; la CHECK es el guardrail último. Si entra mucho ruido de usuarios admin tropezando con la constraint, abrir issue separado para UX preventiva en el form.

## Rollback

Si post-apply se descubre necesidad legítima de codes mixtos:

```sql
alter table public.referrals drop constraint referrals_code_lowercase_chk;
```

Reversible sin pérdida de datos. Las 5 filas existentes seguirían lowercase (estado actual), pero futuros inserts podrían usar capitalización. Antes de rollback considerar: ¿por qué? El uso del `code` como lookup key requiere normalización consistente; mezclar casing reintroduce el bug que #52 cerró.
