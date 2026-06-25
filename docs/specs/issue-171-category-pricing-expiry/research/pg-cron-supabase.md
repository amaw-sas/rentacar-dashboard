# Research — pg_cron en Supabase (para Pieza 2 del fix #171)

**Fecha:** 2026-06-25
**Fuente:** docs oficiales de Supabase (vía MCP `search_docs`, no memoria):
- https://supabase.com/docs/guides/cron/install
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/cron/quickstart

## Estado en prod (`ilhdholjrnbycyvejsub`)
- `pg_cron`: **disponible, no instalado** (`pg_available_extensions` sí, `pg_extension` no).
- `pg_net`: no instalado. **No lo necesitamos** — el job corre SQL inline, no HTTP.

## Instalación
```sql
create extension if not exists pg_cron;
```
- **NO forzar `with schema pg_catalog`.** Este prod corre pg_cron 1.6.4; el image de Supabase
  coloca la extensión donde su versión espera (crea el schema `cron`), y forzar el schema puede
  fallar o mal-ubicar objetos en images nuevos. Dejar que Supabase lo coloque.
- **NO añadir grants especulativos** (`grant ... on schema cron to postgres`). En Supabase el rol
  `postgres` ya tiene los privilegios de `cron` por defecto; el grant puede ser innecesario y
  *él mismo* fallar (el rol que ejecuta `apply_migration` quizá no es dueño de los objetos de
  `cron` para otorgarlos), enmascarándose como falla de instalación. Solo añadir grants si aparece
  un error de permiso verificado.
- La extensión crea el schema `cron`. Jobs en `cron.job`, corridas en `cron.job_run_details`.
- **Confirmar tras instalar:** `list_extensions` / `select extname, extnamespace::regnamespace from
  pg_extension where extname='pg_cron'` antes de aseverar SCEN-8.
- **Plan B (del spec) — dos disparadores, no uno:** si `create extension pg_cron` falla por
  (a) privilegios o (b) mal-ubicación de schema vía `apply_migration`, backfill + trigger se
  aplican igual; el job se agenda a mano desde Integrations → Cron en el dashboard **con el mismo
  `jobname`** (`category-pricing-expire-daily`) y command con la cadena `category_pricing`.
  Verificar con SCEN-8.

## Agendar (idempotente)
```sql
select cron.schedule(
  'category-pricing-expire-daily',          -- nombre fijo, case-sensitive
  '0 6 * * *',                              -- 06:00 UTC = 01:00 America/Bogota
  $$
  UPDATE public.category_pricing
     SET status = 'inactive'
   WHERE status = 'active'
     AND valid_until IS NOT NULL
     AND valid_until < (now() AT TIME ZONE 'America/Bogota')::date
  $$
);
```
- **Upsert por nombre:** re-ejecutar `cron.schedule` con el mismo `jobname` **reemplaza** el job
  (no duplica) → la migración es idempotente al re-aplicar.
- El `command` contiene la cadena `category_pricing` → la query de verificación de SCEN-8
  (`WHERE command ILIKE '%category_pricing%'`) lo encuentra.
- **Timezone:** el *schedule* (`0 6 * * *`) se evalúa en UTC. La *lógica de vigencia* usa
  `America/Bogota` dentro del SQL, desacoplada de la hora de disparo. Correr a las 06:00 UTC
  (01:00 Bogotá) garantiza que ya pasó la medianoche en Bogotá del día previo.

## Otras operaciones (referencia)
- Editar: `cron.alter_job(job_id, schedule, command, ...)` o re-`cron.schedule` con mismo nombre.
- Activar/desactivar: `cron.alter_job(job_id, active := true|false)`.
- Borrar: `cron.unschedule('category-pricing-expire-daily')` (la historia en `job_run_details` queda).
- Inspeccionar corridas: `select * from cron.job_run_details where jobid=(...) order by start_time desc`.

## Decisión
Una migración (`071`) con: `create extension if not exists pg_cron` → función trigger → trigger →
`cron.schedule` → backfill. El job corre SQL inline (sin `pg_net`, sin Edge Function), porque la tarea es pura
mantención de un flag, cero lógica de negocio ni llamadas externas. `cron.job_run_details` es el
audit; no creamos tabla de log propia (YAGNI del spec).
