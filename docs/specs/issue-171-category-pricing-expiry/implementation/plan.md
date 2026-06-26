# Plan de implementación — #171 `category_pricing` expiry

**Fecha:** 2026-06-25
**Spec:** `../design.md` · **Scenarios:** `../scenarios/category-pricing-expiry.scenarios.md` · **Research:** `../research/pg-cron-supabase.md`
**Estimado global:** S-M · **Riesgo:** Bajo (cambio aditivo, reversible, sin código TS)

---

## Chunk 1: File structure + plan

### File structure map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/<ts>_071_category_pricing_expiry.sql` | **crear** | Única unidad de cambio. Contiene, en orden: (a) `create extension pg_cron`, (b) función trigger `category_pricing_expire_on_write()`, (c) trigger `category_pricing_set_inactive_on_expiry`, (d) `cron.schedule(...)`, (e) backfill `UPDATE`. Aplicado vía MCP `apply_migration`. |
| `lib/types/database.ts` | **no tocar** | Vestigial, no se regenera (memoria). Sin cambio de tipos. |
| `lib/actions/category-pricing.ts` | **no tocar** | El trigger DB hace cumplir la invariante; la action no necesita lógica nueva. |

**Decisión de decomposición:** todo el fix es schema/datos en una migración. No hay código TS
porque el consumidor real (rentacar-web) lee la DB directo; normalizar el dato lo cubre. Una sola
migración mantiene atómico el cambio en prod (salvo Plan B de pg_cron, ver Step 4).

No hay segundo chunk: el plan completo cabe en <1000 líneas y es lógicamente uno.

---

## Prerequisitos
- Worktree aislado (regla permanente: nunca codear en branch actual).
- Branch de testing de Supabase con fixture sembrado (las preview branches no traen data de prod — memoria).
- Cuenta `gh` `pabloandi` para PR/labels (memoria); restaurar `amaw-dev` al final.
- **NUNCA `supabase db push`** (arrastra drops 049/051 — memoria). Deploy = MCP `apply_migration`.

---

## Steps

> Cada step define su escenario ANTES de escribir SQL, lo implementa y lo verifica en la branch
> de testing. No hay steps "solo de tests": la verificación está embebida en cada step.

### Step 1 — Descubrimiento previo + worktree + branch con fixture · Size: M · Dep: none
**Primero el watermark (bloquea el diseño del SQL, por eso va aquí, no al final):** `grep` en este
repo por consumidores de `category_pricing.updated_at` como watermark de sync/cache; chequear si
rentacar-web lo usa. El resultado decide si el backfill/job pueden bumpear `updated_at` (lo normal)
o deben evitarlo — no se puede finalizar el SQL de Pieza 1/2 sin saberlo. Documentar.

Crear worktree `.worktrees/issue-171-category-pricing-expiry` desde `main`. Crear/refrescar branch
de testing de Supabase. **Toda escritura del fixture y toda simulación de SCEN se ejecuta vía SQL
privilegiado RLS-exento** (MCP `apply_migration`/`execute_sql` con rol service, igual que corren el
cron real y el backfill) — nunca bajo un cliente RLS-bound, o un UPDATE podría matchear 0 filas por
RLS y dar falso verde en SCEN-3. `category_pricing` tiene RLS con 4 policies.

Sembrar fixture mínimo que cubra todos los casos:
- ≥2 filas `active` con `valid_until < HOY_CO` (vencidas) — para SCEN-1.
- ≥1 fila `active` con `valid_until >= HOY_CO` (vigente) — no debe tocarse.
- ≥1 fila `active` con `valid_until IS NULL` (abierta) — no debe tocarse.
- ≥1 fila `inactive` con `valid_until >= HOY_CO` (vigente apagada) — para SCEN-5/SCEN-7.

**Aceptación:** resultado del watermark documentado; `select` del fixture muestra los 4 grupos;
`vencidas_pero_active > 0` y `count` de vigentes-active > 0 antes de aplicar nada (precondición que
permite distinguir "0 cambios por elegibilidad" de "0 por RLS" en SCEN-3).

### Step 2 — Pieza 3: trigger de escritura · Size: M · Dep: Step 1
Definir función `category_pricing_expire_on_write()` (`BEFORE INSERT OR UPDATE`): si
`NEW.valid_until IS NOT NULL AND NEW.valid_until < (now() AT TIME ZONE 'America/Bogota')::date`
entonces `NEW.status := 'inactive'`. Crear el trigger con `drop trigger if exists ... ` previo
(idempotente — ver Step 5).

**Ordering vs trigger existente:** ya existe `on_category_pricing_updated` (BEFORE UPDATE,
`handle_updated_at`). Postgres dispara los BEFORE en orden alfabético de nombre. Nombrar el nuevo
trigger de forma que el orden sea explícito y benigno; como tocan campos distintos (`status` vs
`updated_at`) el orden no afecta el resultado, pero se documenta para no depender de la suerte.

**Aceptación (SCEN-4 ambas ramas, SCEN-7):**
- **UPDATE** de una fila `active` con `valid_until` pasado → persiste `inactive`.
- **INSERT** de una fila nueva con `valid_until` pasado y `status='active'` → persiste `inactive`.
  (Rama distinta: el INSERT NO dispara `on_category_pricing_updated`, que es UPDATE-only; el nuevo
  trigger es el único que actúa, y `updated_at` queda en su default de columna.) Verificar las dos
  ramas por separado, no solo una.
- UPDATE de una fila `inactive` vigente poniéndola `status='active'` explícito → persiste `active`
  (el trigger no la apaga porque está vigente). Único camino de reactivación.

### Step 3 — Pieza 1: backfill · Size: S · Dep: Step 2
Añadir a la migración el `UPDATE ... SET status='inactive' WHERE status='active' AND valid_until
IS NOT NULL AND valid_until < (now() AT TIME ZONE 'America/Bogota')::date`. Aplicar a la branch.

**Aceptación (SCEN-1):** tras el backfill `vencidas_pero_active = 0`; el conteo de filas afectadas
(vía `RETURNING`) = nº de vencidas del fixture; ninguna fila vigente o `valid_until NULL` cambió.

### Step 4 — Pieza 2: pg_cron job · Size: M · Dep: Step 3
Añadir `create extension if not exists pg_cron;` (**sin** `with schema`, **sin** grants
especulativos — ver research) + `cron.schedule('category-pricing-expire-daily','0 6 * * *',
$$ UPDATE ... $$)` (command idéntico al backfill, con la cadena `category_pricing`). Aplicar a la
branch y **confirmar el schema de la extensión** (`list_extensions`) antes de aseverar SCEN-8.

**Aceptación (SCEN-8, SCEN-2, SCEN-3, SCEN-5) — todo vía SQL privilegiado RLS-exento:**
- Gate estricto SCEN-8: `count(*)=1 AND bool_and(active) AND bool_and(schedule='0 6 * * *')` sobre
  `cron.job WHERE command ILIKE '%category_pricing%'` → true.
- Ejecutar el UPDATE del job a mano sobre una fila `active valid_until=HOY_CO-1` → `inactive` (SCEN-2).
- Ejecutar el UPDATE con todo vigente → **0 filas cambian, habiendo vigentes-active elegibles**
  (precondición del Step 1) → confirma que el 0 es por elegibilidad, no por RLS (SCEN-3).
- Una `inactive` vigente sigue `inactive` tras el UPDATE (SCEN-5).
- **Plan B (dos disparadores):** si `create extension pg_cron` falla por privilegios **o** por
  mal-ubicación de schema vía `apply_migration`, documentar; backfill + trigger ya aplicados;
  agendar el job a mano en Integrations → Cron con el **mismo `jobname`** (`category-pricing-expire-daily`,
  el upsert previene duplicados) y command con `category_pricing`; re-verificar SCEN-8.

### Step 5 — Migración consolidada + idempotencia sobre estado ya-aplicado · Size: M · Dep: Step 4
Consolidar las 5 piezas en el archivo final `<ts>_071_category_pricing_expiry.sql` con comentario
de cabecera (estilo migraciones 063/042). **Cada statement explícitamente idempotente** (el deploy
a prod re-aplica sobre un estado que ya puede tener todo aplicado, dada la drift de registro
063-070 que la memoria documenta):
- `create extension if not exists pg_cron;`
- `create or replace function category_pricing_expire_on_write() ...`
- `drop trigger if exists category_pricing_set_inactive_on_expiry on public.category_pricing;`
  seguido de `create trigger ...` (un `create trigger` pelado **error**a en re-apply).
- `cron.schedule('category-pricing-expire-daily', ...)` — upsert por nombre (no duplica).
- backfill `UPDATE` — no-op natural en segunda corrida (ya no hay `active` vencidas).

**Verificar idempotencia sobre branch YA-aplicada, no fresca:** aplicar la migración completa una
vez, luego aplicarla **de nuevo sobre la misma branch** (que ya la tiene) y confirmar 0 errores,
1 solo job, 1 solo trigger.

**Aceptación:** segunda aplicación sobre estado ya-migrado no produce error, no duplica job ni
trigger; SCEN-1…8 todos verdes tras la doble aplicación.

### Step 6 — Deploy a prod · Size: S · Dep: Step 5
Aplicar la migración a prod (`ilhdholjrnbycyvejsub`) vía MCP `apply_migration` (NUNCA db push).
Renombrar el archivo local a `<timestamp>_071_<name>.sql` para alinear con `schema_migrations`
remoto (memoria). Verificar en prod.

**Aceptación (en prod):** SCEN-1 (`vencidas_pero_active = 0` — gate único; `total_active` cae a ~60
es informativo, no gate), SCEN-6 (invariante permanente = 0), SCEN-8 (job agendado). Confirmar que
las 6 gamas legacy quedaron `inactive`.

### Step 7 — PR + cierre · Size: S · Dep: Step 6
Abrir PR (gh `pabloandi`) con evidencia fresca de SCEN-1…8 en testing y prod. Cerrar #171 con
comentario que referencie la verificación. Restaurar `amaw-dev`. Limpiar branch de testing y worktree.

**Aceptación:** PR mergeable, CI verde (type-check/lint/test/build — esta migración no toca TS,
no debería romper nada), #171 cerrado con evidencia.

---

## Mapa step → escenario

| Step | Escenarios verificados |
|---|---|
| 1 | (setup: watermark `updated_at` resuelto + fixture; precondición `vencidas_pero_active > 0` y vigentes-active > 0) |
| 2 | SCEN-4 (ramas INSERT y UPDATE), SCEN-7 |
| 3 | SCEN-1 |
| 4 | SCEN-8, SCEN-2, SCEN-3, SCEN-5 |
| 5 | SCEN-1…8 (idempotencia sobre estado ya-aplicado + regresión completa) |
| 6 | SCEN-1, SCEN-6, SCEN-8 (en prod) |

Todos los 8 escenarios del holdout quedan cubiertos antes de prod; SCEN-6 (invariante permanente)
se re-verifica en prod como gate final. El watermark `updated_at` (blast radius) se resuelve en
Step 1, antes de finalizar el SQL, para no crear dependencia hacia adelante.

---

## Testing Strategy
- **No vitest:** pg_cron/trigger no son testeables en jsdom/vitest. La verificación es SQL contra
  la branch de testing de Supabase (Steps 2-5) y prod (Step 6). **Todo vía SQL privilegiado
  RLS-exento** (la tabla tiene RLS con 4 policies; un cliente RLS-bound daría falsos verdes).
- **Fixture-driven:** Step 1 siembra los 4 grupos de filas; cada SCEN asevera sobre ese fixture.
- **Regresión + idempotencia:** Step 5 re-aplica la migración completa sobre branch ya-aplicada y
  corre SCEN-1…8 de una.

## Rollout Plan
- **Deploy:** MCP `apply_migration` a prod (Step 6). Cambio aditivo, sin downtime, sin código TS.
- **Monitoreo:** `cron.job_run_details` para confirmar que el job corre diario sin error.
- **Rollback:** reversible. Para revertir: `cron.unschedule('category-pricing-expire-daily')`,
  `drop trigger ... ; drop function ...`, y (si hiciera falta) re-`UPDATE status='active'` sobre
  las filas afectadas filtrando por `updated_at` del deploy. El backfill NO borra datos (solo
  voltea un flag), así que el riesgo es mínimo.

## Open Questions
- ¿`apply_migration` tiene privilegios para `create extension pg_cron`? Se resuelve en Step 4
  (Plan B listo si no).
- ¿Algún consumidor de rentacar-web usa `updated_at` como watermark? Se resuelve en Step 1
  (antes de finalizar el SQL de Pieza 1/2, para no crear dependencia hacia adelante).
