---
name: legacy-categories
created_by: claude
created_at: 2026-05-21T00:00:00Z
amended_at: 2026-05-21T22:40:00Z
issue: 17
parent_audit: 13
---

# Issue #17 — Asegurar que las gamas legacy GR/VP/G/LP estén `inactive`

> **Amend (2026-05-21)** — Premisa corregida con evidencia empírica. El audit #13
> (Q9) asumió que GR/VP/G/LP **no existían** en el destino y había que insertarlas.
> Falso: las 4 ya están definidas en `supabase/seed.sql` (líneas 194/224/230/236)
> y presentes en prod desde **2026-03-30**. La divergencia real es el **status**:
> seed.sql trae GR/LP/VP como `active` (G `inactive`), mientras prod tiene las 4
> `inactive`. La tarea es **garantizar inactive de forma idempotente**, no insertar
> a ciegas. Ver amend marker en `.amends/`.

Migración Supabase única: upsert idempotente que **asegura** que GR/VP/G/LP existan y queden `inactive` para Localiza (`rental_companies.code='localiza'`). Habilita el ETL #20 (las 390 reservas históricas resuelven su `category_code`) y mantiene las gamas fuera de los selectores de nueva reserva (que filtran `status='active'`).

Observable: estado de `public.vehicle_categories` post-apply (SQL contra Supabase) + UI (`/categories`). Solo toca DATA, no DDL.

SQL bajo prueba (upsert ensure-inactive, preserva nombres ricos):

```sql
insert into public.vehicle_categories
  (rental_company_id, code, name, description, status)
select rc.id, v.code, v.name, v.description, 'inactive'
from public.rental_companies rc
cross join (values
  ('G',  'Gama G Camioneta Mecánica',              'Camioneta mecánica'),
  ('GR', 'Gama GR Camioneta Automática 7 puestos', 'Camioneta automática 7 puestos'),
  ('LP', 'Gama LP Sedán Automático Híbrido',       'Sedán automático híbrido'),
  ('VP', 'Gama VP Camioneta Mecánica de Platón',   'Camioneta mecánica de platón')
) as v(code, name, description)
where rc.code = 'localiza'
on conflict (rental_company_id, code)
do update set status = 'inactive', updated_at = now()
where public.vehicle_categories.status is distinct from 'inactive';
```

---

## SCEN-001: tras la migración, las 4 gamas existen como `inactive` bajo Localiza

**Given**: un entorno con Localiza (`rental_companies.code='localiza'`); las gamas GR/VP/G/LP pueden o no pre-existir, con cualquier status.
**When**: se aplica `<timestamp>_047_legacy_categories_ensure_inactive.sql`.
**Then**: `SELECT COUNT(*) FROM public.vehicle_categories WHERE rental_company_id = (SELECT id FROM public.rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP') AND status='inactive'` retorna `4`. Calificado por `rental_company_id` para no contar codes homónimos de otra compañía (S2).
**Evidence**: salida de `mcp__supabase__execute_sql` post-apply.

## SCEN-002: el upsert es idempotente (re-run sin error, sin duplicar, sigue 4 inactive)

**Given**: las 4 gamas ya en estado `inactive` por SCEN-001.
**When**: se re-ejecuta el statement upsert crudo vía `mcp__supabase__execute_sql`.
**Then**: retorna éxito sin `duplicate key`, el COUNT de SCEN-001 sigue `4`, y `updated_at` de las 4 filas **no cambia** respecto al run previo (la guard `status is distinct from 'inactive'` evita el write redundante).
**Evidence**: respuesta sin error + COUNT=4 + comparación de `updated_at` antes/después.

## SCEN-003: el selector de nueva reserva NO ofrece las gamas legacy

**Given**: las 4 filas `inactive`. Prueba primaria por código: `getActiveVehicleCategories()` (`lib/queries/vehicle-categories.ts:25`) filtra `.eq("status","active")`; `app/(dashboard)/reservations/new/page.tsx` consume solo esa query y `reservation-form.tsx:277-282` filtra por `rental_company_id` — las inactivas nunca entran al form.
**When**: un admin abre `/reservations/new`, abre el combobox de categoría y escribe `GR`.
**Then**: la lista de opciones queda vacía (interacción explícita open+type; runtime completo diferido a #22 — esta issue valida la prueba por código).
**Evidence**: lectura de la cadena consumidora (query→page→form) + corroboración agent-browser opcional.

## SCEN-004: la página admin `/categories` SÍ lista las 4 gamas como `inactive`

**Given**: las 4 filas `inactive`. `app/(dashboard)/categories/page.tsx:8` usa `getVehicleCategories()` (sin filtro de status) — el admin las ve para gestión histórica.
**When**: un admin autenticado abre `/categories`.
**Then**: las 4 gamas (GR/VP/G/LP) aparecen en la tabla con estado `Inactiva`, junto a las activas de contraste.
**Evidence**: snapshot de `agent-browser` de la tabla `/categories` mostrando las 4 con badge `Inactiva` + cero errores de consola.

## SCEN-005: el lookup de FK que usará el ETL de #20 resuelve los 4 codes

**Given**: las 4 filas con `rental_company_id` de Localiza.
**When**: `SELECT code FROM public.vehicle_categories WHERE rental_company_id = (SELECT id FROM public.rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP') ORDER BY code`.
**Then**: 4 filas — `G`, `GR`, `LP`, `VP` — confirmando que las 390 reservas legacy no se rechazarían por categoría inexistente (sujeto a S1: todas Localiza-sourced).
**Evidence**: salida tabular de `mcp__supabase__execute_sql`.

## SCEN-006: la migración respeta CHECK y UNIQUE constraints

**Given**: schema de `004_vehicle_categories.sql` — `status IN ('active','inactive')`, `unique (rental_company_id, code)`, columnas NOT NULL con defaults.
**When**: `mcp__supabase__apply_migration` ejecuta el archivo.
**Then**: éxito sin `check constraint violation` ni `null value violates not-null` ni `duplicate key`. En INSERT (entorno vacío) las columnas omitidas toman defaults del schema.
**Evidence**: respuesta sin error de `apply_migration`; `SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '%_047_legacy_categories_ensure_inactive'`.

## SCEN-007: una gama pre-existente `active` se voltea a `inactive` SIN perder su nombre rico

**Given**: en un entorno seed-like, GR existe como `active` con `name='Gama GR Camioneta Automática 7 puestos'` (estado de `seed.sql`).
**When**: se aplica la migración 047.
**Then**: GR queda `status='inactive'` **y conserva** `name='Gama GR Camioneta Automática 7 puestos'` (la cláusula `do update set status,...` no toca `name`/`description` — no los degrada a un placeholder).
**Evidence**: SELECT de `code, name, status` para GR antes (active) y después (inactive, mismo name) del apply.

## SCEN-008: en prod (ya inactive) el upsert es un no-op real (no bumpea updated_at)

**Given**: prod, donde las 4 gamas ya están `inactive`.
**When**: se aplica la migración 047.
**Then**: 0 filas afectadas por el `DO UPDATE` (la guard `status is distinct from 'inactive'` las salta); `updated_at` de las 4 filas permanece en su valor previo (early April), no `now()`.
**Evidence**: comparación de `updated_at` de las 4 filas pre/post apply (idénticos).

---

## Fuera de scope (NO son escenarios de esta migración)

- **ETL de las 390 reservas legacy**: vive en #20.
- **GX / LY**: prod tiene estas 2 gamas inactivas adicionales; fuera del set de #17 (audit Q9 = GR/VP/G/LP).
- **FK constraint sobre `reservations.category_code`**: no existe y no se agrega aquí.
- **Modificar `getActiveVehicleCategories`**: ya filtra `status='active'` correctamente; cero cambios de código frontend.
- **`visibility_mode` de LP/VP**: seed las trae `restricted`; irrelevante para filas inactive (no llegan al selector). No se toca.

## Rollback

Forward-only. Si post-apply se decide que alguna gama debe volver a `active` (decisión de flota, dominio): `UPDATE ... SET status='active' WHERE code=...`. Nunca DELETE tras el ETL #20 (dejaría `category_code` huérfano sin FK que lo bloquee).
