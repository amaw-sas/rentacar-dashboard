# Plan de implementación — Issue #129: cache TTL + single-flight de `getCategoryNameMap`

**Spec:** `docs/specs/2026-06-11-issue-129-cache-category-names-design.md` (aprobado 2026-06-11)
**Worktree:** `.worktrees/issue-129-cache-category-names` · branch `task/issue-129-cache-category-names`
**Holdout SDD:** SCEN-009..013 (definidos en el spec)

## Chunk 1: Implementación y cierre

### Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `lib/api/category-names.ts` | modificar | Extraer cuerpo actual a `fetchCategoryNameMap()` privada (sin cambio de lógica); añadir `getCategoryNameMap()` con cache TTL + single-flight; exportar `CATEGORY_NAME_TTL_MS`; comentario no-mutar en el retorno. **Firma pública intacta.** |
| `tests/unit/api/category-names.test.ts` | modificar | Añadir SCEN-009..013. Extender harness con rebind a client fresco para escenarios de 2 fetches. SCEN-007.x quedan intactos. |

**No se tocan:** `app/api/reservations/availability/route.ts` (consumidor, llama igual), `lib/api/availability-enrichment.ts`, schema, env, migraciones, `db:types`.

### Prerequisitos
- Worktree ya creado. Sin dependencias nuevas. `pnpm` disponible.

### Step 1 — Cache TTL + single-flight (atómico) | Size: M | Dependencies: none

El cambio de producción es indivisible: no se puede extraer el cuerpo a `fetchCategoryNameMap`
sin añadir el wrapper con cache en la misma edición. Por eso los 5 escenarios holdout van en
un solo step SDD red→green; todos fallan antes (sin cache, dos llamadas = dos fetches) y pasan
después.

**Harness — dos mecanismos (el mock actual solo sirve 1 fetch):**

El `createMockSupabase` actual encadena exactamente 2 `.mockReturnValueOnce` en `from`
(despacho **por orden de llamada**, no por nombre de tabla) y **sin fallback** → un solo
fetch lo agota; un 2º fetch obtiene `undefined` y lanza `undefined.select` *en setup*. Un
`.mockReturnValue` único de respaldo NO sirve: el call 3 (`rental_companies`, necesita
`.single()`) y el call 4 (`vehicle_categories`, thenable) tienen formas distintas; un solo
builder crashea en uno de los dos. Se necesitan dos mecanismos:

- **Despacho por nombre de tabla (SCEN-009, SCEN-012):** convertir el `from` de
  `createMockSupabase` a `mockImplementation((table) => table === "rental_companies" ?
  { select: companySelect } : { select: categoriesSelect })`. Así sirve **N fetches
  repetidos** con las mismas filas, despachando el builder correcto por argumento. Un 2º/
  concurrente fetch *filtrado* (código sin cache) **alcanza el assert** → se observa
  `from` 4×, en vez de crashear. Con el green (cache/single-flight) el 2º acceso no hace
  fetch → `from` 2×. Las **mismas filas** importan en el camino **red** (el 2º fetch
  filtrado debe producir un mapa igual, para que SCEN-009 falle por *demasiados fetches*,
  no por contenido distinto); en green el 2º acceso devuelve `cache.map` y nunca toca el
  mock. **SCEN-007.x siguen verdes:** las aserciones `toHaveBeenNthCalledWith(n, "tabla")`
  y los spies `companySelect`/`categoriesSelect` se preservan con `mockImplementation`.
- **Rebind a client fresco (SCEN-010, SCEN-011, SCEN-013):** `vi.mocked(createAdminClient)
  .mockReturnValue(secondClient)` antes del 2º fetch. Funciona porque `fetchCategoryNameMap`
  llama `createAdminClient()` de nuevo en cada fetch. Permite filas **distintas** (010/013)
  o pasar de error→éxito (011) en el refetch. Cada client solo necesita sus 2 builders (no
  fallback, porque cada fetch usa un client fresco).

**Scenario → Code → Satisfy → Refactor:**

1. **RED:** Escribir SCEN-009..013 en `category-names.test.ts`. Cada uno debe **alcanzar su
   assert** contra el código actual (no crashear en setup) y fallar por la razón correcta:

   | Escenario | Setup | Assert | Red esperado (sin cache) |
   |---|---|---|---|
   | SCEN-009 hit < TTL | 2 llamadas seq, `from` por `mockImplementation` (despacho por tabla), `setSystemTime` < TTL | `from` llamado 2× | **falla: `from` 4×** (2 fetches) |
   | SCEN-010 expiry ≥ TTL | 1ª llamada, rebind client con filas nuevas, avanzar ≥ TTL, 2ª llamada | mapa refleja filas nuevas | **falla: 2ª refetchea siempre** → el assert de "no refetch antes de TTL" no aplica; aquí el red es que sin cache no hay noción de TTL — ver nota |
   | SCEN-011 fallo no-cachea | 1er fetch rechaza, rebind client OK, 2ª llamada | 2ª tiene éxito | sin cache pasa trivial → **red real = afirmar que NO se sirve un fallo cacheado**; ver nota |
   | SCEN-012 single-flight cold | `Promise.all([get(),get()])`, `from` por `mockImplementation` | `from` 2× | **falla: `from` 4×** (2 fetches concurrentes) |
   | SCEN-013 expirado+concurrente | poblar, avanzar ≥ TTL, rebind, `Promise.all` de 2 | `from` del refetch 2× | **falla: `from` del refetch 4×** (sin single-flight, 2 refetches) |

   **Nota SCEN-010/011 (red honesto):** sin cache, "refetch tras TTL" y "reintento tras
   fallo" pasarían trivialmente (siempre se fetchea). El red discriminante de estos dos no
   es contra "sin cache" sino contra **una implementación de cache rota**: SCEN-010 falla si
   el cache no expira (sirve filas viejas tras ≥ TTL); SCEN-011 falla si el fallo SÍ se
   cachea (2ª llamada devuelve el error cacheado en vez de reintentar). Por eso su prueba de
   no-trivialidad (abajo) revierte/rompe el green selectivamente, no compara contra el
   código pre-cache. Documentar esto en el test para que el red sea verificable.
2. **GREEN:** Modificar `lib/api/category-names.ts`:
   - Renombrar el cuerpo actual de `getCategoryNameMap` → `async function fetchCategoryNameMap()` (privada). Lógica idéntica (resolver Localiza · proyección `CATEGORY_NAME_COLUMNS` · filtro `rental_company_id` · throw-on-error). Las invariantes #74 se preservan por construcción.
   - Añadir estado module-level: `cache`, `inflight`, `export const CATEGORY_NAME_TTL_MS = 5 * 60_000`.
   - Nuevo `getCategoryNameMap()`: guarda `cache` (fresco) → guarda `inflight` → lanza fetch, puebla cache en `.then`, limpia `inflight` en `.finally`.
   - Comentario en el retorno: el `Map` es compartido por referencia; los callers NO deben mutarlo.
3. **SATISFY:** Confirmar SCEN-009..013 verdes por ejecución; los 7 SCEN-007.x siguen verdes (cada uno 1 fetch).
4. **REFACTOR:** Limpieza si aplica (claridad de nombres/comentarios), sin cambiar comportamiento.

**Anti-reward-hacking (prueba de no-trivialidad por escenario):**
- Los escenarios son holdout del spec, escritos antes del código GREEN; no se reescriben para encajar con el output.
- **SCEN-009/012:** con el cache revertido deben **alcanzar el assert** y ver `from` 4× (no crashear en setup) — de ahí el despacho por nombre de tabla (`mockImplementation`). Confirmar el red ejecutando contra el código pre-cache.
- **SCEN-010:** romper selectivamente el green (cache que no expira: quitar la guarda `expiresAt > Date.now()`) debe hacerlo fallar (sirve filas viejas tras ≥ TTL).
- **SCEN-011:** romper el green (cachear también el fallo: poblar `cache` en el camino de rechazo — p.ej. añadir un `.catch` que set-ee `cache`, o set-ear en `.finally`) debe hacerlo fallar (2ª llamada devuelve el error cacheado en vez de reintentar). Nota: "mover el set fuera del `.then`" no compila tal cual (`map` no está en scope); usar la variante `.catch`/`.finally`.
- **SCEN-013:** quitar la guarda `inflight` debe hacerlo fallar (`from` del refetch 4×, dos refetches).
- **Borde TTL:** con `>` estricto, avanzar exactamente `CATEGORY_NAME_TTL_MS` cae en refetch (no hit) — SCEN-009 usa `< TTL`, SCEN-010/013 usan `≥ TTL`.

**Acceptance criteria:**
- `pnpm test tests/unit/api/category-names.test.ts` → SCEN-007.x (7) + SCEN-009..013 (5) verdes.
- Cada SCEN-007.x sigue observando **exactamente 1 fetch** (`from` 2×) en aislamiento → prueba que `vi.resetModules()` en `beforeEach` (load-bearing, no remover) resetea `cache`/`inflight` entre tests; sin esto un test que pobló el cache haría flake a un SCEN-007 posterior (`from` 0×).
- `pnpm test` (suite completa) → sin regresiones.
- `pnpm type-check` → 0 errores. `pnpm lint` → 0 warnings.
- Firma `getCategoryNameMap(): Promise<Map<string,string>>` sin cambios; `route.ts` no modificado.
- Invariantes #74 preservadas: las dos queries, la proyección `CATEGORY_NAME_COLUMNS`, el filtro `rental_company_id` y el throw-on-error dentro de `fetchCategoryNameMap` son byte-idénticos al cuerpo original (líneas 20-47 de hoy); solo cambian el nombre de la función y el wrapper añadido. Verificable leyendo el diff, no por identidad literal de `git diff` (el rename cambia la firma).

### Step 2 — Quality gate + verificación + PR | Size: S | Dependencies: Step 1

1. **4-agentes** sobre el diff: code-reviewer, security-reviewer, edge-case-detector, performance-engineer. Adjudicar hallazgos (no aceptar a ciegas); aplicar los reales.
2. **/verification-before-completion**: evidencia fresca de los 5 escenarios + suite + type-check + lint + build.
3. **Commit** (mensaje EN, `--no-verify` solo si el marcador SDD ya fue consumido y el gate real está hecho).
4. **PR** con `pabloandi` (gh dual-account; restaurar `amaw-dev` después). **`Closes #129`** (scope completo: este es todo el alcance del issue, no parcial).
5. **Memoria:** actualizar `issue_74_category_translation.md` cerrando el hilo "cache→#129" (de diferido a resuelto en PR de #129).

**Acceptance criteria:**
- Hallazgos de los 4 agentes adjudicados y resueltos o justificados.
- Gate de verificación con output fresco (no memoria).
- PR abierto contra main con descripción, blast radius y `Closes #129`.

## Testing Strategy
- **Unit (Vitest):** SCEN-009..013 nuevos + SCEN-007.x existentes. `vi.useFakeTimers()` + `vi.setSystemTime()` para tiempo determinista; rebind de `createAdminClient` para 2 fetches; `vi.resetModules()` (ya en `beforeEach`) para aislar estado de módulo entre tests.
- **Sin runtime/e2e nuevo:** el comportamiento observable externo de `/api/reservations/availability` no cambia (traducción idéntica); el #74 ya verificó end-to-end en prod. El cache es transparente. No requiere /agent-browser (sin UI) ni nuevo hit a prod.

## Rollout Plan
- **Deploy:** merge a main → Vercel auto-deploy. Sin migración, sin env, sin feature flag.
- **Monitoreo:** logs `localiza_category_unmapped` siguen igual; no hay nuevo error path. Cache se auto-cura en cold start.
- **Rollback:** revertir el PR. El código vuelve al fetch-por-request del #74; sin estado persistente que limpiar (el cache es in-memory por instancia).

## Riesgo
- **Overall:** S. Un archivo de producción, refactor interno, firma intacta, degradación segura preservada.
- **Vector principal:** mutación futura del `Map` compartido → mitigado con comentario de contrato.
