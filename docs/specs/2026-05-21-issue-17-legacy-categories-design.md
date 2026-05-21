# Design — Issue #17: agregar categorías legacy GR/VP/G/LP como `inactive`

- **Fecha:** 2026-05-21
- **Issue:** #17 (sigue al audit #13, decisión Q9 = opción A)
- **Bloquea:** #20 (ETL reservations), #22 (dry-run)
- **Estado:** aprobado para spec → SDD

## Problema

El legacy `rentacar-admin` tiene 390 reservas (3.0% de 12.967) en 4 gamas que no existen en el set destino de `public.vehicle_categories`: GR (312), VP (62), G (14), LP (2). El ETL de #20 valida `category_code` contra `vehicle_categories`; sin estas filas, las 390 reservas se rechazarían. El audit #13 resolvió Q9 = opción A: agregarlas como `status='inactive'` para que migren sin rechazo **pero no aparezcan como opción en los selectores de nueva reserva**.

## Decisión

Una migración SQL `INSERT … SELECT … ON CONFLICT DO NOTHING` (enfoque A — declarativo, idempotente, portable). Sin código aplicativo, sin cambios de schema.

```sql
insert into public.vehicle_categories
  (rental_company_id, code, name, description, status)
select rc.id, v.code, v.name,
       'Categoría legacy archivada — solo para histórico migrado',
       'inactive'
from public.rental_companies rc
cross join (values
  ('GR','Gama GR'),
  ('VP','Gama VP'),
  ('G','Gama G'),
  ('LP','Gama LP')
) as v(code, name)
where rc.code = 'localiza'
on conflict (rental_company_id, code) do nothing;
```

Las columnas NOT NULL no listadas toman defaults del schema (`004_vehicle_categories.sql`): `image_url=''`, `passenger_count=0`, `luggage_count=0`, `has_ac=true`, `transmission='manual'`.

### Por qué enfoque A

- **Una sola sentencia declarativa**, sin variables ni control de flujo.
- **Portable entre branches**: resuelve `rental_company_id` por `code='localiza'`, no por UUID hard-coded (los branches Supabase tienen UUIDs distintos).
- **Idempotente**: `ON CONFLICT (rental_company_id, code) DO NOTHING` — la unique key existe en `004_vehicle_categories.sql:15`.
- **Falla segura**: sin `localiza`, el cross join sobre conjunto vacío inserta 0 filas (no UUID NULL). Detectado por E1.

Alternativas B (DO block con `SELECT INTO STRICT`) y C (UUID hard-coded) descartadas: B aporta verbosidad procedural innecesaria porque pre-flight #16 ya validó que `localiza` existe; C rompe portabilidad entre branches.

## Por qué `status='inactive'` basta — UI audit

Verificado en código (no asumido):

- `lib/queries/vehicle-categories.ts:25` — `getActiveVehicleCategories()` filtra `.eq("status","active")`.
- Consumidores que usan esa query (filtran inactivas fuera):
  - `app/(dashboard)/reservations/new/page.tsx:15` — form nueva reserva.
  - `app/(dashboard)/reservations/[id]/edit/page.tsx:30` — form edición.
- Consumidor sin filtro:
  - `app/(dashboard)/categories/page.tsx:8` → `getVehicleCategories()` (todas). Admin SÍ debe verlas para gestión histórica — comportamiento correcto, no bug.

Consecuencia: **cero cambios de código frontend**. El INSERT con `status='inactive'` es suficiente para que ningún form de reserva las ofrezca.

## Boundaries

Sin cambios en queries, server actions, contratos, schema DDL, ni `lib/types/database.ts` (la migración es solo data; `db:types` produce **cero diff** — cualquier diff es blocker). Contenido a 1 archivo SQL nuevo + 4 filas de data.

## Supuestos explícitos

- **S1 — Localiza es la única dueña de estos codes.** Las 390 reservas legacy en GR/VP/G/LP provienen de Localiza (`rental_companies.code='localiza'`). El ETL de #20 resuelve categoría por `(rental_company_id, code) = (localiza_id, <code>)`. Si alguna reserva legacy perteneciera a otra compañía, E5 pasaría pero el ETL la rechazaría — fuera del set validado por este spec. Sostenido por pre-flight #16 (lookup `categories.id → category_code` sobre data Localiza).
- **S2 — Ningún otro `rental_company_id` tiene codes GR/VP/G/LP.** Si lo tuviera, E1 sin qualifier de compañía sobrecontaría. Por eso E1 y E5 califican por `rental_company_id` de Localiza explícitamente.

## Error handling

- Sin `localiza` en `rental_companies`: 0 filas insertadas (cross join vacío). E1 lo detecta al asertar COUNT = 4.
- Re-aplicación: `ON CONFLICT DO NOTHING` → sin error, sin duplicado (E2).
- RLS heredada de `004_vehicle_categories.sql` (admin-only insert/update, read autenticado). La migración corre como service-role vía CLI, no sujeta a RLS.

## Naming

Convención reciente (043–046): `<timestamp>_NNN_<name>.sql`. Archivo: `supabase/migrations/<timestamp>_047_legacy_categories_for_audit.sql`. Tras `apply_migration` vía MCP, renombrar el archivo local al timestamp remoto real (memoria `feedback_supabase_migration_naming`).

## Testing

SQL puro — no hay unit tests vitest aplicables. Validación:

1. **Aplicación**: `apply_migration` en branch Supabase de pruebas (MCP), no prod.
2. **Queries de verificación** contra el branch (E1, E2, E5).
3. **Runtime (`/agent-browser`)**: smoke test de `/reservations/new` (E3, selector NO muestra GR/VP/G/LP) y `/categories` (E4, las lista como inactivas). Cero errores consola, cero requests fallidos.

## Observable scenarios

1. **E1 — Aplicación limpia.** **Dado** un branch con migraciones 001–046 y `rental_companies` con `code='localiza'`, **cuando** se aplica 047, **entonces** `SELECT COUNT(*) FROM vehicle_categories WHERE rental_company_id = (SELECT id FROM rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP') AND status='inactive'` = **4**. (Calificado por `rental_company_id` para no contar codes homónimos de otra compañía — ver S2.)
2. **E2 — Idempotencia.** **Dado** las 4 filas ya insertadas, **cuando** se re-ejecuta el **statement INSERT crudo** (no el re-apply de la migración, que `schema_migrations` saltaría), **entonces** termina sin error gracias a `ON CONFLICT DO NOTHING` y el COUNT de E1 sigue **4** (no duplica).
3. **E3 — UI nueva reserva no ofrece legacy.** Prueba primaria por código (ya auditada): `getActiveVehicleCategories()` filtra `status='active'`, y `/reservations/new` + `/edit` la consumen — las inactivas nunca llegan al form. **Corroboración runtime** (agent-browser, no es la prueba primaria): **dado** las 4 filas `inactive`, **cuando** un admin abre `/reservations/new`, **abre el combobox de categoría y escribe "GR"**, **entonces** la lista de opciones queda vacía (interacción explícita, no snapshot estático — el combobox shadcn puede estar colapsado/virtualizado, ver memoria `agent_browser_form_submit_gotcha`).
4. **E4 — Admin /categories sí las lista.** **Dado** las 4 filas, **cuando** un admin abre `/categories`, **entonces** las 4 aparecen con estado `inactive` (verificado por interacción agent-browser: localizar las 4 filas en la tabla).
5. **E5 — Lookup FK del ETL futuro resuelve.** **Dado** las 4 filas con `rental_company_id` de Localiza, **cuando** se hace `SELECT code FROM vehicle_categories WHERE rental_company_id = (SELECT id FROM rental_companies WHERE code='localiza') AND code IN ('GR','VP','G','LP')`, **entonces** los 4 codes resuelven (las 390 reservas legacy no se rechazarían por categoría inexistente — sujeto a S1).

## Criterios de satisfacción

- [ ] E1–E5 verificados con evidencia (queries + snapshots agent-browser).
- [ ] Archivo sigue convención `<timestamp>_047_<name>.sql`, alineado con `schema_migrations` remoto.
- [ ] `pnpm db:types` ejecutado; `lib/types/database.ts` con **cero diff** (cualquier diff = blocker).
- [ ] CI verde (type-check + lint + test + build).
- [ ] PR abierta linkeando #17 con sección "Verificación" listando E1–E5.

## Fuera de alcance

- Modificar `getActiveVehicleCategories` (ya filtra correcto).
- Añadir FK constraint en `reservations.category_code` (issue independiente si se decide).
- Cargar imágenes/datos reales para GR/VP/G/LP — son archivo histórico, no se reactivan.
- ETL de #20 — issue separada.

## Referencias

- Audit #13 §5 Q9, §6 #N2; comentario de cierre (recomendación A).
- Schema: `supabase/migrations/004_vehicle_categories.sql`, `002_rental_companies.sql`.
- UI filter: `lib/queries/vehicle-categories.ts:20-30`.
