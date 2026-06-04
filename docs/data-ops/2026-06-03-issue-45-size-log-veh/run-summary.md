# Sizing de `log_veh_available_rates_queries` (legacy) — issue #45, Fase 1

**Corrida:** 2026-06-04, prod legacy vía túnel SSH (read-only).
**Script:** `scripts/migration/size-log-veh.py` · MariaDB 10.11.15 · presupuesto kill-switch 15s.

## El número que importa

La tabla tiene **~658 mil filas pero pesa 28.7 GiB**. Eso son ~46 KB por fila de promedio — no es una tabla de logs ligera, es un histórico gordo con payload grande por registro (parámetros de búsqueda + respuestas crudas). Ahí está la explicación de por qué un `SELECT *` colgó prod legacy en su momento: traer todo es mover casi 29 GB de una sentada.

| Métrica | Valor | Fuente |
|---|---|---|
| Filas (aprox) | ~657,984 | `information_schema.TABLE_ROWS` |
| Filas exactas | sin dato | `COUNT(*)` no termina ni en 15s (ver abajo) |
| Tamaño datos | 28.7 GiB (30,795,104,256 B) | `DATA_LENGTH` |
| Índices | 0 B | solo PK clustered, sin secundarios |
| Total | 28.7 GiB | `DATA_LENGTH + INDEX_LENGTH` |
| Promedio por fila | ~46 KB | `data_bytes / approx_rows` |
| Rango temporal | 2024-05-27 → 2026-05-11 | proxy-PK (`id` 22730 → 686855) |

El span sale de leer la primera y última fila por PK (`ORDER BY id ASC/DESC LIMIT 1`, dos seeks O(1)), no de un `MIN/MAX(created_at)` — esa columna no tiene índice y escanearla habría sido justo el full scan que queríamos evitar. EXPLAIN confirma que el span usa `key=PRIMARY, rows=1`.

## El COUNT exacto no se pudo, y está bien

`COUNT(*)` no terminó ni con 15s ni con 1s de presupuesto. El servidor lo abortó solo, vía `max_statement_time`, y el script lo registró como `{value: null, timed_out_after_s: N}` sin tratarlo como error. La conclusión no es "falló el conteo" — es un dato en sí mismo: **la tabla es tan grande que ni siquiera contarla entra en un presupuesto razonable**. Para Fase 1 nos basta el aproximado de `information_schema` (~658k); pedir el exacto no aporta y solo arriesga bloqueo.

El kill-switch quedó confirmado en las dos corridas (`max_statement_time` releído a 15.0s y 1.0s). Garantía real, no asumida: ninguna query tocó la tabla sin tope de tiempo del lado servidor.

## Qué significa para la extracción (Fase 2)

Tres cosas quedan claras para cuando elijamos método:

1. **Nada de traer todo de una.** 28.7 GB no caben en memoria ni en una transacción cómoda. La extracción va por lotes paginados por `id` (rango de PK), con presupuesto por lote.
2. **El volumen real es ~658k filas en 2 años**, no las ≫500k multi-año difusas que sospechábamos. Acotado y datable: se puede partir por rangos de `id` o por ventanas de fecha vía proxy-PK.
3. **Fuera de horario.** Aunque cada lote sea barato, mover 29 GB acumulados merece correr cuando el legacy está ocioso.

La elección de método (mysqldump por rango vs. lectura paginada vía script vs. `SELECT INTO OUTFILE`) es una sesión aparte. Lo que cierra Fase 1 es la dimensión: sabemos contra qué nos enfrentamos.

## Condiciones de la corrida

- **Acceso:** túnel SSH `127.0.0.1:3307` → EC2 `rentacar` → RDS `rentacar-admin` (MariaDB 10.11.15). Usuario de app, read-only por sesión.
- **Sesión:** `SET SESSION TRANSACTION READ ONLY` + `max_statement_time` armado y verificado antes de tocar la tabla.
- **Artefacto máquina:** reporte JSON PII-free en `docs/migration-runs/` (gitignored). Solo metadata, conteos y timestamps — cero payload de filas.
- **Scenarios:** 7/7 satisfechos (SCEN-001 happy-path, 002 env, 003 conexión, 004 abort por presupuesto, 005 read-only, 006 PII-free/atómico, 007 kill-switch). El abort por presupuesto (004) se validó en prod real, no solo en unit.

## Notas de operación

Dos tropiezos que valen para la próxima:

- `LEGACY_DB_HOST=localhost` hace que pymysql use **socket Unix** e ignore el puerto — se salta el túnel. Hay que poner `127.0.0.1` para forzar TCP.
- El túnel `ssh -fN -L` puede morir en silencio: el proceso sigue vivo y el puerto local escucha, pero deja de reenviar. Levantarlo con `-o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes` evita el zombie.
