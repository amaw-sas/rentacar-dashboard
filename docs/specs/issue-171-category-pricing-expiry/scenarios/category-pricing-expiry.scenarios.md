# Scenarios — #171 `category_pricing` expiry

Holdout observable para SDD. Verificación = branch de testing de Supabase + aserciones SQL.
Cada escenario define "done"; no son tests de implementación.

> **"hoy" = día en Bogotá:** toda comparación usa `(now() AT TIME ZONE 'America/Bogota')::date`,
> no `current_date` (UTC). Abreviado `HOY_CO` abajo.

---

## SCEN-1 — Backfill inactiva solo lo vencido

**Given** 22 filas `status='active'` con `valid_until < HOY_CO` y el resto de `active` vigentes
**When** corre el UPDATE de backfill (con `RETURNING` para contar)
**Then** `vencidas_pero_active = 0`; `total_active` bajó en exactamente el nº de filas devueltas
por `RETURNING`; **ninguna** fila con `valid_until >= HOY_CO` o `valid_until IS NULL` cambió.

```sql
-- gate real (robusto ante otros writers): debe quedar en 0
SELECT count(*) AS vencidas_pero_active
FROM category_pricing
WHERE status='active' AND valid_until IS NOT NULL
  AND valid_until < (now() AT TIME ZONE 'America/Bogota')::date;
-- esperado: 0  (total_active ~60 es informativo, NO gate)
```

## SCEN-2 — El job atrapa el paso del tiempo

**Given** una fila `status='active'`, `valid_until = HOY_CO - 1`
**When** corre el UPDATE del job **a mano** (no se espera al cron real — eso lo cubre SCEN-8)
**Then** esa fila queda `status='inactive'`.

## SCEN-3 — El job no produce falsos positivos

**Given** todas las filas `active` son vigentes (`valid_until >= HOY_CO` o `IS NULL`)
**When** corre el UPDATE del job
**Then** **0** filas cambian (`UPDATE ... RETURNING` vacío).

## SCEN-4 — El trigger fuerza inactive al escribir fecha pasada

**Given** un admin guarda/edita una fila con `valid_until` en el pasado y `status='active'`
**When** la escritura persiste (INSERT o UPDATE)
**Then** la fila almacenada tiene `status='inactive'`, no `active`.

## SCEN-5 — El job nunca reactiva

**Given** una fila `status='inactive'` cuya ventana es vigente (`valid_until >= HOY_CO`)
**When** corre el UPDATE del job
**Then** la fila sigue `status='inactive'` (el job solo apaga, nunca enciende).

## SCEN-6 — Contrato con la web

**Given** rentacar-web filtra `status='active'` en su fallback season-low
**When** escanea buscando la fila más barata
**Then** ninguna fila con `valid_until` pasado puede ganar, porque tras el fix no existe
ninguna `active` vencida.

```sql
-- invariante permanente que debe quedar en 0
SELECT count(*) AS activas_vencidas
FROM category_pricing
WHERE status='active' AND valid_until IS NOT NULL
  AND valid_until < (now() AT TIME ZONE 'America/Bogota')::date;
-- esperado: 0
```

## SCEN-7 — Reactivación explícita por ops (único camino)

**Given** una fila `status='inactive'` con `valid_until` futuro (gama re-abierta)
**When** el admin guarda la fila con `status='active'` explícito
**Then** persiste `status='active'` — el trigger no la apaga porque está vigente. Es el único
camino de reactivación; el sistema nunca enciende solo.

## SCEN-8 — El job quedó agendado

**Given** la migración aplicó la Pieza 2 (`cron.schedule`)
**When** se consulta el catálogo de pg_cron
**Then** existe **exactamente 1** job activo, schedule `0 6 * * *`, cuyo command toca `category_pricing`.
La unicidad se hace cumplir por el `jobname` fijo (`cron.schedule` upsert por nombre): tanto la
migración como el Plan B manual usan `category-pricing-expire-daily`, así que no pueden coexistir dos.

```sql
-- gate estricto (no eyeball): debe dar true
SELECT count(*) = 1
   AND bool_and(active)
   AND bool_and(schedule = '0 6 * * *') AS scen8_ok
FROM cron.job
WHERE command ILIKE '%category_pricing%';
-- esperado: scen8_ok = true
```
