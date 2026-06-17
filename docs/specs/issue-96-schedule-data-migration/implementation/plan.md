# Plan de implementación — Ola D2 (#96): migración `schedule` texto → estructurado

**Diseño fuente**: `docs/specs/2026-06-17-issue-96-schedule-data-migration-design.md` (aprobado).
**Fecha**: 2026-06-17. **Worktree**: `task/issue-96-schedule-data-migration`.

## Estructura de archivos

| Archivo | Tipo | Responsabilidad única |
|---|---|---|
| `scripts/migration/parse-schedule.ts` | NEW | Parser **puro** `display:string\|null → LocationSchedule`. Sin I/O. Reusa `locationScheduleSchema`/`LocationSchedule` de `@/lib/schemas/location`. Fail-loud en tokens desconocidos. |
| `tests/unit/migration/parse-schedule.test.ts` | NEW | Tests vitest del parser: AC-D2.* + 9 familias reales + fail-loud + festivos implícitos. Holdout SDD vive en `docs/specs/issue-96-schedule-data-migration/scenarios/`. |
| `scripts/migration/build-schedule-migration.ts` | NEW | Runner Node **sin DB**: lee dump JSON, aplica el parser, emite (a) reporte de revisión markdown y (b) SQL idempotente. Determinista. |
| `docs/migration-runs/schedule-migration-runbook.md` | NEW | Runbook: corrida, verificación post-aplicación, reversión desde dump. |
| `docs/migration-runs/schedule-dump-<ts>.json` | GEN | Dump prod previo (read-only MCP). Fuente de rollback. Se commitea (sin PII). |
| `docs/migration-runs/schedule-review-<ts>.md` | GEN | Reporte para el gate humano fila-por-fila. |
| `docs/migration-runs/schedule-migration-<ts>.sql` | GEN | UPDATEs idempotentes aplicados vía MCP tras aprobación. |

**Decomposición**: parser (lógica pura, núcleo testeable) separado del runner (orquestación de
artefactos) separado de la aplicación (MCP, gate humano). Cada pieza se entiende y prueba sola.

**Riesgo técnico a validar en Step 1**: que `@/scripts/migration/parse-schedule` resuelva desde
`tests/unit/` (alias `@/*` = raíz; confirmar que `tsconfig`/vitest incluyen `scripts/`). Si no,
ajustar el import o la config de vitest.

## Prerrequisitos
- #95 (D1) MERGED — `locationScheduleSchema` disponible en `main` (227da5b). ✓
- Acceso MCP Supabase a prod `ilhdholjrnbycyvejsub` (dump read-only + apply tras gate). ✓
- Sin deps nuevas (vitest, zod ya instalados).

## Steps

### Step 1 — Parser: esqueleto + rangos de día + tiempo literal (AC-D2.1, AC-D2.3) | Size: M | Deps: none
Crear `parse-schedule.ts`: firma `parseSchedule(display: string | null | undefined): LocationSchedule`.
- `null`/`undefined`/`""` (trim) → `{}` (sin clave `display`).
- Con texto: split por ` | `; por segmento, emparejar el tiempo-spec contra el conjunto enumerado
  anclado al final (`HH:MM-HH:MM` por ahora), el prefijo es el día-spec; expandir rangos
  `Lun-Vie`/`Lun-Sáb`/`Lun-Dom` sobre `[mon..sun]`; días sueltos. Conservar `display` literal.
- **Escenario** (SCEN-D2.1): `"Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"` →
  ... (el `Dom y fest Cerrado` se completa en Step 2; Step 1 cubre la parte `Lun-Vie`/`Sáb`).
  Acotar el test de Step 1 a `"Lun-Vie 08:00-18:00 | Sáb 08:00-13:00"` → `{mon..fri, sat, display}`.
- **Escenario** (SCEN-D2.3 parcial): `null`/`""` → `{}`.
- **Acceptance**: tests de día-rango + single-day + null pasan; `display` preservado; import alias resuelve.

### Step 2 — Parser: comma-groups, `24 horas`, `Cerrado`, festivos, fail-loud (AC-D2.2, AC-D2.3b, SCEN-D2.8/9) | Size: M | Deps: Step 1
Extender la gramática:
- Tiempo-spec: añadir `24 horas` → `["00:00-24:00"]`; `Cerrado` → `[]`.
- Día-spec: grupos con coma/`y` (`Sáb, Dom y fest` → `[sat,sun,hol]`; `Dom y fest` → `[sun,hol]`);
  `Todos los días` → `mon..sun`; `Festivos`/`fest` → `hol`.
- **Fail-loud**: token de día o tiempo no reconocido → `throw` con el segmento ofensivo.
- Festivos no mencionados → `hol` ausente (decisión 1).
- **Escenario** (SCEN-D2.2): `"Lun-Dom 24 horas | Festivos 06:00-21:00"` → `{mon..sun:["00:00-24:00"], hol:["06:00-21:00"], display}`.
- **Escenario** (SCEN-D2.3b): `"Sáb, Dom y fest 08:00-16:00"` → `{sat,sun,hol todos ["08:00-16:00"], display}`.
- **Escenario** (SCEN-D2.8): `"Lunes 08:00-18:00"` y `"Lun-Vie mañanas"` → throw.
- **Escenario** (SCEN-D2.9): `"Todos los días 07:00-20:00"` → sin `hol`; `"Lun-Vie X | Sáb Y"` → sin `sun`/`hol`.
- **Acceptance**: AC-D2.1 completo (con `Dom y fest Cerrado`), AC-D2.2, AC-D2.3b, fail-loud y festivos implícitos verdes.

### Step 3 — Parser: guard de schema + barrido de las 28 filas reales (AC-D2.4, AC-D2.7) | Size: S | Deps: Step 2
- Antes de retornar, `locationScheduleSchema.parse(result)` → garantiza salida válida (AC-D2.7) y
  falla ruidoso si el parser produjera algo inválido.
- **Escenario** (SCEN-D2.7): test parametrizado sobre los 28 `display` reales (fixture embebido
  tomado del **snapshot del diseño** `2026-06-17-...-design.md`, NO del dump del Step 5 — sin
  forward-dep) → cada uno `locationScheduleSchema.safeParse(...).success === true`. El fixture
  incluye al menos una fila con `schedule` literalmente `null` para fijar el guard `?? null`.
- **Escenario** (SCEN-D2.4): cada salida no vacía conserva `display` literal.
- **Acceptance**: 28/28 filas reales parsean y validan; `display` intacto en todas.

### Step 4 — Runner: reporte de revisión + SQL idempotente (AC-D2.5) | Size: M | Deps: Step 3
Crear `build-schedule-migration.ts` (Node, sin DB):
- Lee `docs/migration-runs/schedule-dump-<ts>.json` (`[{code,name,schedule}]`).
- Por fila: `parseSchedule(schedule?.display ?? null)`; re-valida con `locationScheduleSchema`.
- Emite `schedule-review-<ts>.md` sobre **las 32 filas** del dump (las 4 `{}`/`null` caen en la
  sección destacada de `{}`/`hol` ausente, para que el gate humano vea la tabla completa)
  y `schedule-migration-<ts>.sql` (`UPDATE … WHERE code=… AND schedule IS DISTINCT FROM …::jsonb`).
- **Escenario** (SCEN-D2.5): correr el runner dos veces sobre el mismo dump → SQL byte-idéntico;
  el guard `IS DISTINCT FROM` garantiza no-op en 2ª aplicación.
- **Acceptance**: sobre un dump fixture pequeño, el runner produce reporte + SQL determinista; re-run idéntico.

### Step 5 — Dry-run real + runbook (AC-D2.6) | Size: M | Deps: Step 4
- Generar dump prod vía MCP (read-only `SELECT code,name,schedule`) → `schedule-dump-<ts>.json`.
- Correr el runner → `schedule-review-<ts>.md` + `schedule-migration-<ts>.sql`.
- Escribir `schedule-migration-runbook.md`: pasos de corrida, verificación post (conteos por forma),
  reversión (UPDATE desde dump).
- **Escenario** (SCEN-D2.6): tras la corrida existen dump + runbook de reversión.
- **Acceptance**: artefactos generados y commiteados; **GATE HUMANO** — entregar reporte para
  aprobación fila-por-fila. NO continuar a Step 6 sin aprobación explícita.

### Step 6 — Aplicar a prod vía MCP (gated) | Size: S | Deps: Step 5 + aprobación humana
- Tras aprobación: aplicar `schedule-migration-<ts>.sql` vía MCP `apply_migration` (NUNCA `db push`).
- Verificar: re-aplicar (o `SELECT` post) → 0 filas cambian la 2ª vez (idempotencia AC-D2.5);
  conteos por forma coinciden con el reporte aprobado.
- **Acceptance**: prod refleja el parse aprobado; 2ª aplicación 0 filas; `display` intacto en todas.

## Testing Strategy
- **Unit (vitest)**: Steps 1-3, `tests/unit/migration/parse-schedule.test.ts` — toda AC parser-level.
- **Runner (vitest o ejecución determinista)**: Step 4 sobre dump fixture.
- **Proceso**: AC-D2.5 (idempotencia) y AC-D2.6 (dump+runbook) en Steps 5-6 contra prod real.
- Gate de verificación: `/verification-before-completion` antes de cada commit y antes del apply prod.

## Rollout Plan
- **Dry-run** (Step 5): artefactos sin tocar prod.
- **Gate humano**: aprobación fila-por-fila del reporte.
- **Apply** (Step 6): MCP `apply_migration`, idempotente.
- **Rollback**: UPDATE por código restaurando `schedule` desde `schedule-dump-<ts>.json` (runbook).
- **Monitoreo**: `SELECT` de conteos por forma post-apply; la web sigue leyendo `display` (sin cambio observable para el cliente hasta W1).
