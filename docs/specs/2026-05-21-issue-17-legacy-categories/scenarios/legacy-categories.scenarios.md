---
name: legacy-categories
created_by: claude
created_at: 2026-05-21T00:00:00Z
issue: 17
parent_audit: 13
---

# Issue #17 — Agregar categorías legacy GR/VP/G/LP como `inactive`

Migración Supabase única que agrega 4 códigos de gama del legacy (`GR`, `VP`, `G`, `LP`) a `public.vehicle_categories` con `status='inactive'`, `rental_company_id` resuelto por lookup sobre `rental_companies.code='localiza'`. Habilita el ETL de #20 (las 390 reservas legacy en esas gamas dejan de rechazarse por categoría inexistente) sin exponer las gamas en los selectores de nueva reserva.

Observable: estado de la tabla `public.vehicle_categories` post-apply (SQL contra Supabase) + comportamiento de la UI (`/reservations/new`, `/categories`). La migración solo toca DATA, no DDL.

SQL bajo prueba (enfoque A, declarativo, idempotente):

```sql
insert into public.vehicle_categories
  (rental_company_id, code, name, description, status)
select rc.id, v.code, v.name,
       'Categoría legacy archivada — solo para histórico migrado',
       'inactive'
from public.rental_companies rc
cross join (values
  ('GR','Gama GR'), ('VP','Gama VP'), ('G','Gama G'), ('LP','Gama LP')
) as v(code, name)
where rc.code = 'localiza'
on conflict (rental_company_id, code) do nothing;
```

---

## SCEN-001: las 4 gamas legacy existen como `inactive` bajo Localiza tras aplicar la migración

**Given**: branch Supabase con migraciones 001–046 aplicadas y `public.rental_companies` con una fila `code='localiza'`; ninguna de las gamas `GR`/`VP`/`G`/`LP` existe aún para Localiza.
**When**: se aplica `<timestamp>_047_legacy_categories_for_audit.sql` vía `mcp__supabase__apply_migration`.
**Then**: `SELECT COUNT(*) FROM public.vehicle_categories WHERE rental_company_id = (SELECT id FROM public.rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP') AND status='inactive'` retorna `4`. La calificación por `rental_company_id` evita contar codes homónimos de otra compañía (supuesto S2).
**Evidence**: salida de `mcp__supabase__execute_sql` ejecutado contra el branch post-apply, copiada al artefacto de verificación.

## SCEN-002: re-ejecutar el INSERT crudo es idempotente (no duplica, no falla)

**Given**: las 4 filas ya insertadas por SCEN-001 (la migración ya está registrada en `schema_migrations`, por lo que un re-apply de la migración sería saltado por el tracker).
**When**: se ejecuta el **statement INSERT crudo** del bloque SQL anterior una segunda vez vía `mcp__supabase__execute_sql` (probando el `ON CONFLICT (rental_company_id, code) DO NOTHING`, no el re-apply de la migración).
**Then**: la sentencia retorna éxito sin error de `duplicate key`, y el COUNT de SCEN-001 sigue siendo `4` (cero filas nuevas).
**Evidence**: respuesta sin error de `mcp__supabase__execute_sql` para el INSERT + salida del COUNT post-reejecución = 4.

## SCEN-003: el selector de categoría en nueva reserva NO ofrece las gamas legacy

**Given**: las 4 filas insertadas con `status='inactive'`. Prueba primaria por código: `getActiveVehicleCategories()` (`lib/queries/vehicle-categories.ts:25`) filtra `.eq("status","active")`, y `app/(dashboard)/reservations/new/page.tsx` consume esa query — las inactivas nunca llegan al form.
**When**: un admin abre `/reservations/new`, abre el combobox de categoría y escribe `GR`.
**Then**: la lista de opciones queda vacía (ninguna opción `GR`/`VP`/`G`/`LP`). Interacción explícita open+type (no snapshot estático: el combobox shadcn puede estar colapsado/virtualizado — memoria `agent_browser_form_submit_gotcha`).
**Evidence**: snapshot de `agent-browser` del combobox abierto tras teclear `GR` mostrando lista vacía + cero errores de consola; corrobora la prueba primaria por código (filtro `status='active'`).

## SCEN-004: la página admin `/categories` SÍ lista las 4 gamas como `inactive`

**Given**: las 4 filas insertadas. `app/(dashboard)/categories/page.tsx` consume `getVehicleCategories()` (sin filtro de status), por diseño — el admin debe poder verlas para gestión histórica.
**When**: un admin abre `/categories`.
**Then**: las filas `Gama GR`, `Gama VP`, `Gama G`, `Gama LP` aparecen en la tabla, cada una con estado `inactive`.
**Evidence**: snapshot de `agent-browser` de la tabla `/categories` localizando las 4 filas con su badge `inactive` + cero errores de consola.

## SCEN-005: el lookup de FK que usará el ETL de #20 resuelve los 4 codes

**Given**: las 4 filas con `rental_company_id` de Localiza.
**When**: se ejecuta `SELECT code FROM public.vehicle_categories WHERE rental_company_id = (SELECT id FROM public.rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP') ORDER BY code`.
**Then**: el resultado son exactamente 4 filas — `G`, `GR`, `LP`, `VP` — confirmando que las 390 reservas legacy en esas gamas no se rechazarían por categoría inexistente (sujeto a supuesto S1: todas son Localiza-sourced y el ETL resuelve por `(localiza_id, code)`).
**Evidence**: salida tabular de `mcp__supabase__execute_sql` listando los 4 codes resueltos.

## SCEN-006: la migración respeta los CHECK y UNIQUE constraints del schema

**Given**: schema declarado en `004_vehicle_categories.sql` — `status IN ('active','inactive')`, `transmission IN ('automatic','manual')`, `unique (rental_company_id, code)`, columnas NOT NULL con defaults (`description=''`, `image_url=''`, `passenger_count=0`, `luggage_count=0`, `has_ac=true`, `transmission='manual'`).
**When**: `mcp__supabase__apply_migration` ejecuta el archivo SQL.
**Then**: la llamada retorna éxito (sin `check constraint violation`, sin `null value in column ... violates not-null constraint`, sin `duplicate key`). Las 4 filas toman defaults del schema en las columnas no listadas en el INSERT.
**Evidence**: respuesta sin error de `apply_migration`; verificable con `SELECT version FROM supabase_migrations.schema_migrations WHERE version LIKE '%_047_legacy_categories_for_audit'`.

---

## Fuera de scope (NO son escenarios de esta migración)

- **ETL de las 390 reservas legacy**: vive en #20; esta migración solo crea las categorías destino para que ese ETL no las rechace.
- **FK constraint sobre `reservations.category_code`**: no existe hoy y no se agrega aquí; issue independiente si se decide.
- **Cargar imágenes/datos reales (`image_url`, `passenger_count`, etc.) para GR/VP/G/LP**: son archivo histórico, no se reactivan; quedan en defaults vacíos.
- **Modificar `getActiveVehicleCategories`**: ya filtra `status='active'` correctamente; cero cambios de código frontend.

## Rollback

La migración solo inserta DATA con `ON CONFLICT DO NOTHING`. Reversa si post-apply se descubre error: forward-only `DELETE FROM public.vehicle_categories WHERE rental_company_id = (SELECT id FROM rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP')` — seguro **solo antes** de que #20 popule `reservations.category_code` con esas gamas. Después del ETL, el DELETE dejaría reservas con `category_code` huérfano (no hay FK que lo bloquee), así que la reversa correcta post-ETL es forward-only `UPDATE` de atributos, nunca DELETE.
