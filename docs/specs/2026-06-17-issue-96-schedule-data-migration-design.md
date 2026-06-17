# Diseño — Ola D2 (#96): migración de `schedule` texto libre → estructurado

- **Issue**: amaw-sas/rentacar-dashboard#96 (ola D2 de 3 del trabajo de horarios por sucursal de `rentacar-web#47`).
- **Depende de**: #95 (D1) — el schema `LocationSchedule` define la forma destino. MERGED (commit 227da5b).
- **Bloquea**: la ola web W1 (lectura estructurada del calendario/selector).
- **Fecha**: 2026-06-17.

## Problema

Las 32 sucursales (`locations`) guardan su horario como texto libre en `schedule.display`
(ej. `"Lun-Vie 08:00-18:00 | Sáb, Dom y fest 08:00-16:00"`). D1 añadió el contrato
estructurado v2 (`LocationSchedule`: claves `mon|tue|wed|thu|fri|sat|sun|hol`, cada una
un array de rangos `"HH:MM-HH:MM"`), pero **nadie pobló esas claves todavía**. La web no
puede restringir el calendario proactivamente porque el horario no es consultable por día.

Esta ola transforma el texto a la forma estructurada **conservando `display`** (la web lo
sigue leyendo hasta la ola web W1). Tras la migración la columna `schedule` JSONB tiene
ambas formas coexistiendo.

## Datos reales (snapshot prod, 2026-06-17, `ilhdholjrnbycyvejsub`)

32 sucursales (31 `active` + 1 `inactive`). Familias de patrones observadas en `display`:

| # | Patrón | Sucursales (código) | Mapeo destino |
|---|---|---|---|
| 1 | `null` / `{}` | AAMDL, ACBED, ACMNN, ACMDL(inactive) | queda `{}` |
| 2 | `Todos los días HH:MM-HH:MM` | AABAN, AABCR, AACTG, AASMR, ACBEX, ACBNN, ACMJM | `mon..sun` |
| 3 | `Lun-Dom 24 horas \| Festivos HH:MM-HH:MM` | AABOT | `mon..sun:["00:00-24:00"]`, `hol:[rango]` |
| 4 | `Lun-Dom HH:MM-HH:MM` | ACBSD | `mon..sun` |
| 5 | `Lun-Vie X \| Sáb, Dom y fest Y` | AACUC, AAMTR, AANVA, AAPEI, AARME, AAVAL, ACBAN, ACBCR, ACIBG, ACKPA, ACMNZ, ACMTR, ACVLL | `mon..fri:X`, `sat=sun=hol:Y` |
| 6 | `Lun-Sáb X \| Dom y fest Y` | AAKAL | `mon..sat:X`, `sun=hol:Y` |
| 7 | `Lun-Vie X \| Sáb Y` (sin Dom/fest) | ACBOJ, ACSMR | `mon..fri:X`, `sat:Y`; `sun`/`hol` ausentes |
| 8 | `… \| Dom y fest Cerrado` | ACKAL, ACMCL | `sun:[]`, `hol:[]` |
| 9 | `… \| Dom y fest HH:MM-HH:MM` | ACKJC | `sun=hol:[rango]` |

Todos los minutos observados son `:00` o `:30` (compatibles con la grilla de D1).

## Decisiones de producto (cerradas con el dueño)

1. **Festivos no mencionados explícitamente → clave `hol` ausente (= cerrado), fiel al texto.**
   El parser no infiere horario festivo desde el domingo ni desde "Todos los días". Las filas
   donde la sucursal sí abre festivos se corrigen en la **revisión humana** (camino crítico).
   Justificación: AABOT separa `Lun-Dom` de `Festivos`, evidencia de que los rangos de semana
   no implican festivos; inventar horario sería peor que un dato honestamente ausente.

2. **Gate de revisión humana = reporte + dry-run, aprobado fila-por-fila antes de prod.**
   Se genera un reporte (`code, name, display original, JSON parseado`) y NO se escribe nada
   hasta que el dueño valida contra el horario operativo real y aprueba.

## Arquitectura — 3 piezas desacopladas (sin credenciales locales)

El flujo dump → transform → SQL → MCP evita necesitar `SUPABASE_SERVICE_ROLE_KEY` local
(`vercel env pull` devuelve vacío para vars sensibles), mantiene todo auditable y respeta el
gate humano antes de cualquier escritura en prod. Es el patrón dry-run de los `scripts/migration/etl-*`.

### Pieza 1 — `scripts/migration/parse-schedule.ts` (parser puro, corazón)

Función pura, sin I/O, unit-testeable:

```ts
parseSchedule(display: string | null | undefined): LocationSchedule
```

- Reusa el tipo `LocationSchedule` y `locationScheduleSchema` de `@/lib/schemas/location` (D1).
- `null` / `undefined` / `""` (tras trim) → `{}` (AC-D2.3). No emite clave `display`.
- Con texto → la salida **siempre conserva** `display` con el string original (AC-D2.4) y añade
  las claves estructuradas derivadas.
- Gramática:
  - Split por ` | ` (pipe con espacios) → segmentos.
  - Cada segmento = `<día-spec> <tiempo-spec>`. El tiempo-spec se reconoce **emparejando el
    final del segmento contra el conjunto enumerado de literales** (`HH:MM-HH:MM` | `24 horas`
    | `Cerrado`), NO partiendo por el último token — `24 horas` son dos palabras y un split por
    último token rompería AABOT (`"Lun-Dom 24 horas"` → día-spec `"Lun-Dom 24"`). El prefijo
    restante, ya removido el literal de tiempo, es el día-spec.
  - Día-spec → conjunto de claves:
    - Rango `A-B` (`Lun-Vie`, `Lun-Sáb`, `Lun-Dom`): expandir sobre el orden semanal
      `[mon,tue,wed,thu,fri,sat,sun]` entre A y B inclusive.
    - `Todos los días` → `mon..sun`.
    - Grupos con coma / `y`: `Sáb, Dom y fest` → `[sat,sun,hol]`; `Dom y fest` → `[sun,hol]`.
    - Día suelto: `Sáb` → `sat`, `Dom` → `sun`, etc.
    - `Festivos` / `festivos` / `fest` → `hol`.
  - Tiempo-spec → array de rangos:
    - `HH:MM-HH:MM` → `["HH:MM-HH:MM"]`.
    - `24 horas` → `["00:00-24:00"]` (sentinel de D1).
    - `Cerrado` → `[]`.
  - Mapa de días (abreviatura ES → clave): `Lun→mon, Mar→tue, Mié/Mie→wed, Jue→thu,
    Vie→fri, Sáb/Sab→sat, Dom→sun, fest/festivos→hol`.
  - Cada clave resuelta recibe el array de su segmento. Una clave que aparece en >1 segmento
    concatena (no se espera en los datos, pero el comportamiento es definido).
- **Fail-loud**: cualquier token de día o tiempo no reconocido → `throw` con el segmento
  ofensivo (NO se descarta en silencio — un patrón nuevo debe aflorar en el dry-run para
  decisión humana).
- Antes de retornar, la salida pasa por `locationScheduleSchema.parse()` → garantiza AC-D2.7
  (toda salida del parser valida contra el schema de D1) y falla ruidoso si el parser produjera
  algo inválido.

### Pieza 2 — `scripts/migration/build-schedule-migration.ts` (runner Node, sin DB)

- **Entrada**: dump JSON de prod `[{code, name, schedule}]` generado por MCP (read-only),
  guardado en `docs/migration-runs/schedule-dump-<ts>.json`.
- Por fila: `parseSchedule(schedule?.display ?? null)` → re-valida defensivamente con
  `locationScheduleSchema`. El guard `schedule?.display ?? null` mapea una columna `schedule`
  literalmente `null` (no `{}`) a `{}` en vez de hacer crash el runner.
- **Nota AC-D2.7**: el issue dice "pasa `locationSchema`"; como `locationSchema.schedule` ES
  `locationScheduleSchema`, validar el sub-schema del schedule es el chequeo correcto y
  suficiente (el schema de fila completa exigiría campos ajenos al parser como `pickup_address`).
- **Salidas** (a `docs/migration-runs/`):
  - (a) **Reporte de revisión** `schedule-review-<ts>.md`: tabla `code | name | display original |
    JSON parseado`, ordenada por código, con una sección destacada de filas que quedaron `{}`
    o con `hol` ausente (para que el gate humano las mire primero).
  - (b) **SQL idempotente** `schedule-migration-<ts>.sql`: un `UPDATE locations SET schedule =
    '<json>'::jsonb WHERE code = '<code>' AND schedule IS DISTINCT FROM '<json>'::jsonb;` por fila.
    El guard `IS DISTINCT FROM` hace la 2ª corrida un no-op (prueba de AC-D2.5).
- El runner es determinista: misma entrada → mismas salidas (idempotencia a nivel de artefactos).

### Pieza 3 — Aplicación + rollback (vía MCP, tras gate humano)

- **Dump previo** = la misma entrada `schedule-dump-<ts>.json` sirve de fuente de rollback (AC-D2.6).
- **Runbook** `docs/migration-runs/schedule-migration-runbook.md`: pasos de corrida, verificación
  post-aplicación (SELECT de conteos por forma) y reversión (UPDATE restaurando desde el dump).
- **Aplicación**: tras la aprobación fila-por-fila del dueño, se aplica el SQL vía MCP
  `apply_migration` (NUNCA `db push` — arrastra drops de migraciones no relacionadas).

## Idempotencia (AC-D2.5)

Dos capas: (1) el `display` se conserva y es la fuente del parse, así que re-parsear produce
el mismo resultado; (2) el `UPDATE … WHERE schedule IS DISTINCT FROM …` es un no-op si el valor
ya coincide. Re-ejecutar la migración completa no cambia ninguna fila.

## Rollback (AC-D2.6)

El dump `schedule-dump-<ts>.json` captura el `schedule` completo previo de cada fila. La reversión
es un UPDATE por código restaurando el JSON original. Documentado en el runbook. No se commitean
los dumps con PII — `locations` no tiene PII (códigos y horarios públicos), así que el dump SÍ se
commitea como evidencia de la corrida (a diferencia de los backups de customers).

## Testing

`tests/unit/migration/parse-schedule.test.ts` (vitest):

- **AC-D2.1** — `"Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"` →
  `{mon..fri:["08:00-18:00"], sat:["08:00-13:00"], sun:[], hol:[], display:"…"}`.
- **AC-D2.2** — `"Lun-Dom 24 horas | Festivos 06:00-21:00"` →
  `{mon..sun:["00:00-24:00"], hol:["06:00-21:00"], display:"…"}`.
- **AC-D2.3** — `{}`/`null`/`undefined`/`""` → `{}`.
- **AC-D2.3b** — `"Sáb, Dom y fest 08:00-16:00"` →
  `{sat:["08:00-16:00"], sun:["08:00-16:00"], hol:["08:00-16:00"], display:"…"}`.
- **AC-D2.4** — toda salida no-vacía conserva el `display` original literal.
- **AC-D2.7** — toda salida pasa `locationScheduleSchema.safeParse(...).success === true`
  (verificado parametrizando sobre las 28 filas reales con display).
- **Patrones reales**: un caso por cada una de las 9 familias (las 28 filas con display).
- **Fail-loud**: `"Lunes 08:00-18:00"` (día no reconocido) y `"Lun-Vie mañanas"` (tiempo no
  reconocido) → `throw`.
- **Festivos implícitos** (decisión 1): `"Todos los días 07:00-20:00"` → sin clave `hol`;
  `"Lun-Vie 08:00-16:00 | Sáb 08:00-13:00"` → sin `sun` ni `hol`.

AC-D2.5 (idempotencia) y AC-D2.6 (dump+runbook) se verifican a nivel de runner/proceso durante
la corrida real (no son unit-testeables puros): re-correr el runner sobre la misma entrada
produce SQL byte-idéntico; aplicar el SQL dos veces deja 0 filas afectadas la 2ª vez.

## Out of scope

- DDL / cambio de columna (la JSONB ya existe desde antes).
- Regenerar `display` desde la forma estructurada → ola D3.
- UI de edición de horario por día → ola D3 (#97).
- Inferir horario festivo no escrito → explícitamente descartado (decisión 1).

## Observable scenarios (puente a SDD)

- **SCEN-D2.1**: dado `"Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"`, cuando se
  parsea, entonces `{mon..fri:["08:00-18:00"], sat:["08:00-13:00"], sun:[], hol:[], display}`.
- **SCEN-D2.2**: dado `"Lun-Dom 24 horas | Festivos 06:00-21:00"`, cuando se parsea, entonces
  `{mon..sun:["00:00-24:00"], hol:["06:00-21:00"], display}`.
- **SCEN-D2.3**: dado `null`/`{}`/`""`, cuando se parsea, entonces `{}`.
- **SCEN-D2.3b**: dado `"Sáb, Dom y fest 08:00-16:00"`, cuando se parsea, entonces los tres días
  (sat, sun, hol) reciben el mismo rango.
- **SCEN-D2.4**: dado cualquier display no vacío, cuando se parsea, entonces la salida conserva
  `display` literal.
- **SCEN-D2.5**: dado el SQL generado, cuando se aplica dos veces, entonces la 2ª aplicación
  afecta 0 filas (guard `IS DISTINCT FROM`).
- **SCEN-D2.6**: dado una corrida, cuando termina, entonces existe `schedule-dump-<ts>.json` +
  runbook de reversión.
- **SCEN-D2.7**: dado cualquier display real de las 28 filas, cuando se parsea, entonces la salida
  pasa `locationScheduleSchema`.
- **SCEN-D2.8** (fail-loud): dado un token de día/tiempo no reconocido, cuando se parsea, entonces
  el parser lanza (no descarta en silencio).
- **SCEN-D2.9** (festivos implícitos): dado un display sin mención de festivos, cuando se parsea,
  entonces `hol` queda ausente.
