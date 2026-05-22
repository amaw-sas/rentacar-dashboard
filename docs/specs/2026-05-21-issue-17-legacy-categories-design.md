# Design — Issue #17: asegurar que las gamas legacy GR/VP/G/LP estén `inactive`

- **Fecha:** 2026-05-21
- **Issue:** #17 (sigue al audit #13)
- **Bloquea:** #20 (ETL reservations), #22 (dry-run)
- **Estado:** reframed tras verificación empírica → SDD

## Reframe (2026-05-21) — premisa del audit corregida con evidencia

El audit #13 (Q9) asumió que GR/VP/G/LP **no existen** en el destino y había que insertarlas. La verificación empírica lo desmiente:

- **Prod ya las tiene** (SQL contra `ilhdholjrnbycyvejsub`): las 4 existen `inactive` bajo Localiza, creadas **2026-03-30** (~6 semanas antes del audit), con nombres ricos ("Gama GR Camioneta Automática 7 puestos"). Prod además tiene GX/LY inactivas (fuera del set de #17).
- **`seed.sql` ya las define** (líneas 194/224/230/236) — pero con status divergente: G `inactive`, GR/LP/VP `active`.

La divergencia real no es "faltan", es **status drift**: seed dice `active` para GR/LP/VP, prod dice `inactive` para las 4. La tarea correcta es **garantizar `inactive` de forma idempotente**, no insertar a ciegas.

## Problema

Las 390 reservas legacy (3.0% de 12.967) en GR (312), VP (62), G (14), LP (2) deben resolver su `category_code` en el ETL #20, y las gamas no deben aparecer en los selectores de nueva reserva (que filtran `status='active'`). Como las categorías ya existen en prod/seed, el riesgo es que en entornos seed-based (local `db reset`, posible branch dry-run #22) nazcan `active` y se cuelen en el selector.

## Decisión

**Dos cambios coordinados:**

1. **Migración upsert ensure-inactive** (`INSERT … ON CONFLICT DO UPDATE SET status='inactive' WHERE status IS DISTINCT FROM 'inactive'`), usando los nombres reales de prod:

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

2. **Fix de `seed.sql`**: GR/LP/VP `active` → `inactive` (G ya lo estaba). Necesario porque en `db reset` las migraciones corren **antes** del seed — la migración 047 sobre DB vacía es no-op y el seed recrearía GR/LP/VP `active`. Solo el fix de seed hace que los entornos frescos nazcan inactive.

Las columnas NOT NULL no listadas toman defaults del schema en INSERT.

### Por qué upsert (no INSERT…DO NOTHING)

- **Cubre los 3 entornos**: prod (ya inactive → no-op real por la guard `is distinct from`), seed-based (flip active→inactive), branch vacío sin seed (INSERT crea inactive con nombres reales → ETL #20 resuelve).
- **`INSERT…DO NOTHING` fallaría**: donde el seed ya creó GR/LP/VP `active`, un DO NOTHING las dejaría `active` → visibles en selector → viola la intención de #17 (descubierto empíricamente; el branch testing inicial lo enmascaró por carecer de seed).
- **Preserva nombres ricos**: el `DO UPDATE SET status` no toca `name`/`description`.
- **No-op real en prod**: la guard `WHERE status is distinct from 'inactive'` evita writes y bumps de `updated_at` redundantes.
- **Portable**: resuelve `rental_company_id` por `code='localiza'`, no UUID hard-coded.

## Por qué `status='inactive'` basta — UI audit

Verificado en código (no asumido):

- `lib/queries/vehicle-categories.ts:25` — `getActiveVehicleCategories()` filtra `.eq("status","active")`.
- Consumidores que usan esa query (filtran inactivas fuera):
  - `app/(dashboard)/reservations/new/page.tsx:15` — form nueva reserva.
  - `app/(dashboard)/reservations/[id]/edit/page.tsx:30` — form edición.
- Consumidor sin filtro:
  - `app/(dashboard)/categories/page.tsx:8` → `getVehicleCategories()` (todas). Admin SÍ debe verlas para gestión histórica — comportamiento correcto, no bug.

Consecuencia: **cero cambios de código frontend**. Con `status='inactive'` garantizado por la migración, ningún form de reserva las ofrece.

## Boundaries

Sin cambios en queries, server actions, contratos, schema DDL, ni `lib/types/database.ts` (solo data; `db:types` produce **cero diff** — cualquier diff es blocker). Contenido a: 1 migración SQL (`047_legacy_categories_ensure_inactive`) + fix de 3 líneas en `supabase/seed.sql`.

## Supuestos explícitos

- **S1 — Localiza es la única dueña de estos codes.** Las 390 reservas legacy en GR/VP/G/LP provienen de Localiza (`rental_companies.code='localiza'`). El ETL de #20 resuelve categoría por `(rental_company_id, code) = (localiza_id, <code>)`. Si alguna reserva legacy perteneciera a otra compañía, E5 pasaría pero el ETL la rechazaría — fuera del set validado por este spec. Sostenido por pre-flight #16 (lookup `categories.id → category_code` sobre data Localiza).
- **S2 — Ningún otro `rental_company_id` tiene codes GR/VP/G/LP.** Si lo tuviera, E1 sin qualifier de compañía sobrecontaría. Por eso E1 y E5 califican por `rental_company_id` de Localiza explícitamente.

## Error handling

- En `db reset` la migración corre sobre DB vacía (no hay `localiza` aún → 0 filas); el fix de `seed.sql` cubre ese path. En prod/branch ya seedeado, la migración resuelve `localiza` y normaliza.
- Re-aplicación / re-run: `ON CONFLICT DO UPDATE … WHERE status IS DISTINCT FROM 'inactive'` → sin error, sin write si ya inactive (SCEN-002/008).
- RLS heredada de `004_vehicle_categories.sql`. La migración corre como service-role, no sujeta a RLS.

## Naming

Convención reciente (043–046): `<timestamp>_NNN_<name>.sql`. Archivo: `supabase/migrations/<timestamp>_047_legacy_categories_ensure_inactive.sql`. Tras apply remoto, alinear el nombre local con `schema_migrations` (memoria `feedback_supabase_migration_naming`).

## Testing

SQL — no hay unit tests vitest aplicables. Escenarios canónicos en `scenarios/legacy-categories.scenarios.md` (SCEN-001..008). Validación: `apply_migration` + queries SQL contra el branch Supabase `testing` (no prod); corroboración agent-browser de `/categories`.

## Observable scenarios

Contrato canónico (write-once, amendado): **`docs/specs/2026-05-21-issue-17-legacy-categories/scenarios/legacy-categories.scenarios.md`**. Resumen:

- **SCEN-001** 4 inactive bajo Localiza tras apply (qualified por `rental_company_id`, S2).
- **SCEN-002** idempotente: re-run sin error, sin bump de `updated_at`.
- **SCEN-003** selector nueva reserva no ofrece legacy (prueba por código; runtime completo → #22).
- **SCEN-004** `/categories` las lista `Inactiva` (agent-browser).
- **SCEN-005** lookup FK del ETL #20 resuelve los 4 codes (S1).
- **SCEN-006** `apply_migration` sin violación de constraints.
- **SCEN-007** flip `active→inactive` preservando nombre rico (no degrada a placeholder).
- **SCEN-008** en prod (ya inactive) no-op real: la guard `is distinct from` no bumpea `updated_at`.

## Criterios de satisfacción

- [x] SCEN-001/002/005/006/007/008 verificados en branch `testing` (SQL via MCP).
- [x] SCEN-004 corroborado con agent-browser (`/categories` muestra las 4 `Inactiva`).
- [x] SCEN-003 probado por código (cadena query→page→form); runtime completo diferido a #22.
- [ ] `pnpm db:types` ejecutado; `lib/types/database.ts` con **cero diff**.
- [ ] CI verde (type-check + lint + test + build).
- [ ] PR linkeando #17 con sección Verificación.

## Fuera de alcance

- Modificar `getActiveVehicleCategories` (ya filtra correcto).
- FK constraint en `reservations.category_code` (issue independiente si se decide).
- GX/LY (prod las tiene inactive; fuera del set Q9 de #17).
- ETL de #20 — issue separada.

## Referencias

- Audit #13 §5 Q9, §6 #N2; comentario de cierre (recomendación A).
- Schema: `supabase/migrations/004_vehicle_categories.sql`, `002_rental_companies.sql`.
- UI filter: `lib/queries/vehicle-categories.ts:20-30`.
