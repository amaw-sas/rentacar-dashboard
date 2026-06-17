---
name: schedule-migration
created_by: claude
created_at: 2026-06-17T00:00:00Z
issue: amaw-sas/rentacar-dashboard#96
design: docs/specs/2026-06-17-issue-96-schedule-data-migration-design.md
---

# Issue #96 — migración `schedule` texto → estructurado (ola D2)

Parser puro `parseSchedule(display: string | null): LocationSchedule` + runner que genera
reporte de revisión + SQL idempotente. Conserva `display`. Festivos no mencionados → `hol`
ausente (decisión de producto). Fail-loud en tokens desconocidos.

## SCEN-001 (AC-D2.1): semana + sábado + domingo/festivo cerrado
**Given**: `display = "Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"`
**When**: `parseSchedule(display)`
**Then**: `{ mon:["08:00-18:00"], tue:[...], wed:[...], thu:[...], fri:["08:00-18:00"], sat:["08:00-13:00"], sun:[], hol:[], display:"<original>" }`
**Evidence**: objeto retornado en `tests/unit/migration/parse-schedule.test.ts`

## SCEN-002 (AC-D2.2): 24 horas + festivos con rango
**Given**: `display = "Lun-Dom 24 horas | Festivos 06:00-21:00"`
**When**: `parseSchedule(display)`
**Then**: `{ mon..sun:["00:00-24:00"], hol:["06:00-21:00"], display:"<original>" }`
**Evidence**: objeto retornado; cada día `["00:00-24:00"]`, hol `["06:00-21:00"]`

## SCEN-003 (AC-D2.3): vacío/null permisivo
**Given**: `display` es `null`, `undefined`, `""`, o `"   "` (solo espacios)
**When**: `parseSchedule(display)`
**Then**: `{}` (objeto vacío, sin clave `display`)
**Evidence**: `parseSchedule(null)` etc. retorna `{}` (deep-equal)

## SCEN-004 (AC-D2.3b): grupo con coma se expande a los tres días
**Given**: `display = "Sáb, Dom y fest 08:00-16:00"`
**When**: `parseSchedule(display)`
**Then**: `{ sat:["08:00-16:00"], sun:["08:00-16:00"], hol:["08:00-16:00"], display:"<original>" }`
**Evidence**: objeto retornado; los tres días reciben el mismo rango

## SCEN-005 (AC-D2.4): display original se conserva literal
**Given**: cualquier `display` no vacío
**When**: `parseSchedule(display)`
**Then**: la salida contiene `display` con el string original sin modificar
**Evidence**: `result.display === inputDisplay` para cada caso

## SCEN-006 (AC-D2.7): toda salida valida contra el schema D1
**Given**: cada uno de los 28 `display` reales del snapshot prod (más una fila `schedule` literal `null`)
**When**: `parseSchedule(display)`
**Then**: la salida pasa `locationScheduleSchema.safeParse(...).success === true`
**Evidence**: barrido parametrizado en el test, 28/28 (+null) success=true

## SCEN-007 (fail-loud): token no reconocido lanza
**Given**: `display = "Lunes 08:00-18:00"` (día no reconocido) o `"Lun-Vie mañanas"` (tiempo no reconocido)
**When**: `parseSchedule(display)`
**Then**: lanza un error que nombra el segmento ofensivo (NO descarta en silencio ni retorna parcial)
**Evidence**: `expect(() => parseSchedule(...)).toThrow()` en el test

## SCEN-008 (festivos implícitos): sin mención de festivos → hol ausente
**Given**: `display = "Todos los días 07:00-20:00"` y separadamente `"Lun-Vie 08:00-16:00 | Sáb 08:00-13:00"`
**When**: `parseSchedule(display)`
**Then**: el primero → `mon..sun:["07:00-20:00"]` SIN clave `hol`; el segundo → `mon..fri` + `sat` SIN `sun` ni `hol`
**Evidence**: `"hol" in result === false` (y `"sun" in result === false` para el segundo)

## SCEN-009 (AC-D2.5, runner): SQL idempotente determinista
**Given**: un dump JSON `[{code,name,schedule}]` de entrada
**When**: el runner `build-schedule-migration` se ejecuta dos veces sobre el mismo dump
**Then**: el SQL emitido es byte-idéntico, y cada `UPDATE` lleva guard `WHERE code=… AND schedule IS DISTINCT FROM …::jsonb`
**Evidence**: dos corridas del runner producen archivos `.sql` idénticos; el guard `IS DISTINCT FROM` está presente por fila

## SCEN-010 (AC-D2.6, proceso): dump + runbook tras la corrida
**Given**: una corrida de migración (dry-run)
**When**: termina
**Then**: existen `schedule-dump-<ts>.json` (fuente de rollback) y `schedule-migration-runbook.md` (reversión documentada)
**Evidence**: archivos presentes en `docs/migration-runs/`

## SCEN-011 (proceso, prod): idempotencia en aplicación real
**Given**: el SQL aprobado aplicado a prod una vez
**When**: se aplica una segunda vez (o se consulta post-apply)
**Then**: la 2ª aplicación afecta 0 filas; los conteos por forma coinciden con el reporte aprobado; `display` intacto en las 32 filas
**Evidence**: rows-affected = 0 en la 2ª aplicación vía MCP; `SELECT` de conteos
