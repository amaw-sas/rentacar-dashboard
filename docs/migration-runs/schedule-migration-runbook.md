# Runbook — migración de horarios texto → estructurado (issue #96, ola D2)

**Proyecto prod**: `ilhdholjrnbycyvejsub` · **Fecha de corrida**: 2026-06-17 · **Tabla**: `locations`
**Artefactos** (en `docs/migration-runs/`):
- `schedule-dump-2026-06-17.json` — dump previo de las 32 filas (`code, name, schedule`). **Fuente de rollback.**
- `schedule-review-2026-06-17.md` — reporte de revisión humana (32 filas, columna `schedule original`).
- `schedule-migration-2026-06-17.sql` — 28 `UPDATE` idempotentes (las 4 filas `{}` no generan UPDATE).

## Alcance del cambio
- 28 sucursales pasan de `{display}` a `{…claves estructuradas…, display}` (se conserva `display`).
- 4 sucursales con `schedule = {}` quedan intactas (AAMDL, ACBED, ACMDL, ACMNN).
- La web sigue leyendo `schedule.display` (sin cambio observable para el cliente hasta la ola web W1).

## Precondición — gate humano (camino crítico)
NO aplicar sin aprobación fila-por-fila de `schedule-review-2026-06-17.md` contra el horario
operativo real. Atención especial a las filas listadas en "Filas que requieren atención":
festivos no declarados quedaron `hol` ausente (= cerrado) — corregir las sucursales que sí
abren festivos ANTES de aplicar (o en una pasada posterior vía la UI de D3).

## Aplicación (tras aprobación)
1. Verificar que prod no cambió desde el dump:
   ```sql
   SELECT code, schedule FROM locations ORDER BY code;
   ```
   comparar contra `schedule-dump-2026-06-17.json`. Si difiere, regenerar dump + SQL.
2. Aplicar `schedule-migration-2026-06-17.sql` vía MCP `apply_migration` (NUNCA `db push` —
   arrastra drops de migraciones no relacionadas). Es un cambio de datos (UPDATE), no DDL.
3. Confirmar filas afectadas = 28.

## Verificación post-aplicación
```sql
-- Conteo por forma: deben quedar 28 con claves estructuradas + 4 vacías.
SELECT
  count(*) FILTER (WHERE schedule ? 'mon') AS estructuradas,
  count(*) FILTER (WHERE schedule = '{}'::jsonb) AS vacias,
  count(*) FILTER (WHERE schedule ? 'display') AS con_display
FROM locations;            -- esperado: 28, 4, 28

-- display intacto (no se perdió ninguno):
SELECT count(*) FROM locations
WHERE schedule ? 'display'
  AND (schedule->>'display') IS NOT NULL;   -- esperado: 28
```

## Idempotencia (AC-D2.5)
Re-aplicar el mismo SQL afecta **0 filas**: cada `UPDATE` lleva `AND schedule IS DISTINCT FROM
…::jsonb`. Verificación:
```sql
-- Re-ejecutar el .sql; el cliente debe reportar 0 filas actualizadas la 2ª vez.
```

## Reversión (rollback)
Restaurar `schedule` de cada fila desde el dump. Generar el SQL de reversión desde
`schedule-dump-2026-06-17.json` (un `UPDATE locations SET schedule = '<original>'::jsonb WHERE
code = '<code>';` por fila) y aplicarlo vía MCP. Como `display` se conservó en la migración, la
reversión solo elimina las claves estructuradas añadidas; no hay pérdida de información.
