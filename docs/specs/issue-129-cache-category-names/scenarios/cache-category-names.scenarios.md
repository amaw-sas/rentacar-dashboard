---
name: cache-category-names
created_by: claude
created_at: 2026-06-11T00:00:00Z
issue: 129
related: [74]
---

# Issue #129 — Cache TTL + single-flight de `getCategoryNameMap`

Follow-up de perf del #74 (PR #128). `getCategoryNameMap()` (`lib/api/category-names.ts`)
hace dos round-trips secuenciales a Supabase por cada availability, sin cache. Se añade un
memo module-level con TTL de 5 min + single-flight (promesa in-flight compartida),
extrayendo el cuerpo actual a una `fetchCategoryNameMap()` privada sin cambio de lógica.

**Firma pública intacta** (`getCategoryNameMap(): Promise<Map<string,string>>`); el
consumidor `app/api/reservations/availability/route.ts` no se toca. Las invariantes #74
(filtro por `rental_company_id`, proyección `CATEGORY_NAME_COLUMNS`, throw-on-error) se
preservan por construcción.

Cobertura: unit tests aislados con mock de `createAdminClient` en
`tests/unit/api/category-names.test.ts`. Tiempo determinista vía `vi.useFakeTimers()` +
`vi.setSystemTime()`. Aislamiento de estado de módulo vía `vi.resetModules()` en
`beforeEach` (load-bearing). Harness: `mockImplementation` despacho-por-tabla para fetches
repetidos con mismas filas (SCEN-012, SCEN-009) y rebind a client fresco para fetches con
filas distintas o error→éxito (SCEN-010, SCEN-011, SCEN-013).

Constante exportada `CATEGORY_NAME_TTL_MS = 5 * 60_000`. Guarda de frescura
`expiresAt > Date.now()` (borde exclusivo: en `t == expiresAt` el cache se considera
expirado → refetch).

---

## SCEN-009: cache hit dentro del TTL no reconsulta la BD

**Given**: `getCategoryNameMap()` se llamó una vez y pobló el cache; el `from` del mock
despacha por nombre de tabla (sirve N fetches repetidos con las mismas filas).
**When**: se llama `getCategoryNameMap()` por segunda vez con el reloj avanzado a `< TTL`
desde el primer fetch.
**Then**: la BD se consulta **una sola vez** en total — `from` fue invocado exactamente
2 veces (un fetch), no 4. Ambas llamadas devuelven mapas con entradas iguales.

**Evidence**: test en `tests/unit/api/category-names.test.ts`. Spy `from` con
`toHaveBeenCalledTimes(2)`; el segundo `Map` devuelto tiene las mismas entradas que el
primero. Red verificado: revertir el cache produce `from` 4×.

## SCEN-010: tras expirar el TTL, el siguiente lookup reconsulta y refleja filas nuevas

**Given**: cache poblado con un primer conjunto de filas; rebind de `createAdminClient` a
un client fresco que devuelve filas distintas (p.ej. una gama renombrada).
**When**: el reloj avanza `>= TTL` y se llama `getCategoryNameMap()` de nuevo.
**Then**: el lookup reconsulta la BD (usa el client fresco) y el `Map` devuelto refleja
las filas nuevas, no las cacheadas. El staleness queda acotado al TTL.

**Evidence**: test que avanza `vi.setSystemTime()` `>= CATEGORY_NAME_TTL_MS` y verifica que
el `Map` contiene el valor nuevo de la fila renombrada. Red verificado: quitar la guarda
`expiresAt > Date.now()` sirve filas viejas y falla este assert.

## SCEN-011: un fallo no se cachea — el siguiente lookup reintenta

**Given**: el primer `fetchCategoryNameMap()` rechaza (error de Supabase); rebind a un
client fresco que resuelve correctamente.
**When**: se llama `getCategoryNameMap()`, rechaza, y se vuelve a llamar.
**Then**: la segunda llamada **reintenta** contra la BD (no devuelve un fallo cacheado) y
tiene éxito, devolviendo el `Map` esperado.

**Evidence**: test donde la primera llamada hace `rejects.toThrow()` y la segunda
`resolves` a un `Map` poblado. Red verificado: poblar `cache` en el camino de rechazo
(`.catch`/`.finally`) hace que la segunda llamada devuelva el fallo cacheado y falle.

## SCEN-012: single-flight — llamadas concurrentes en cold start comparten un fetch

**Given**: cache vacío (cold start); el `from` del mock despacha por nombre de tabla.
**When**: se emiten dos llamadas a `getCategoryNameMap()` en el mismo tick síncrono vía
`Promise.all([getCategoryNameMap(), getCategoryNameMap()])`.
**Then**: la BD se consulta **una sola vez** — `from` invocado exactamente 2 veces, no 4.
Ambas promesas resuelven al mismo `Map`.

**Evidence**: test con `Promise.all` de dos llamadas; spy `from` con
`toHaveBeenCalledTimes(2)`. Red verificado: sin single-flight ambas hacen fetch → `from` 4×.

## SCEN-013: single-flight activo en el path de expiración

**Given**: cache poblado pero expirado (reloj avanzado `>= TTL`); rebind a un client
fresco para el refetch.
**When**: dos llamadas concurrentes llegan en el mismo tick (`Promise.all`).
**Then**: se hace **un solo refetch compartido** — el `from` del client del refetch se
invoca exactamente 2 veces, no 4. Ambas resuelven al mismo `Map` nuevo.

**Evidence**: test que pobla, avanza `>= TTL`, rebinda y emite `Promise.all` de dos; spy
`from` del client del refetch con `toHaveBeenCalledTimes(2)`. Red verificado: quitar la
guarda `inflight` produce dos refetches → `from` del refetch 4×.
