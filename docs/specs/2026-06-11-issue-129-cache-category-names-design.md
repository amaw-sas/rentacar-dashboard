# Issue #129 — Cache de `getCategoryNameMap`

**Estado:** diseño aprobado 2026-06-11
**Issue:** #129 (`perf: cachear getCategoryNameMap — evitar 2 round-trips por availability`)
**Origen:** follow-up consciente del #74 (PR #128); cache diferido en su spec.

## Problema

`getCategoryNameMap()` (`lib/api/category-names.ts`, introducido en #74) enriquece cada
respuesta de `POST /api/reservations/availability` traduciendo las categorías a español.
Hace **dos round-trips secuenciales** a Supabase por request:

1. `rental_companies` — resolver la empresa Localiza por `code` (`.single()`).
2. `vehicle_categories` — leer los pares `code → name` filtrados por `rental_company_id`.

Sin cache. Los datos son casi estáticos: ~1 fila en `rental_companies` + ~18 en
`vehicle_categories`, y la política de flota (no renombrar gamas) hace que cambien muy
rara vez. Es **trabajo desperdiciado a escala**, no un bug: la llamada SOAP a Localiza
domina la latencia (segundos, a veces 504), así que los ~30-80 ms de los queries son un
1-5% relativo, y la ruta degrada seguro (si el lookup falla, sirve la lista cruda con 200).

## Objetivo

Evitar repetir los dos queries en cada availability, acotando el staleness al TTL. No
cambiar la firma pública ni el comportamiento observable de la traducción.

## Alcance / blast radius

- **`lib/api/category-names.ts`** — único archivo de producción modificado. Refactor
  interno; la firma pública `getCategoryNameMap(): Promise<Map<string,string>>` **no cambia**.
- **`tests/unit/api/category-names.test.ts`** — añade escenarios de cache (SCEN-009..012).
- **Consumidor único** `app/api/reservations/availability/route.ts:85` — **no se toca**;
  sigue llamando `await getCategoryNameMap()` igual.
- **`docs/specs/`** — este spec + el plan.
- Sin migraciones, sin cambios de schema, sin `db:types`, sin env vars nuevas.

## Diseño

Tres unidades dentro del módulo, cada una con un propósito claro:

### 1. `fetchCategoryNameMap()` — privada, sin cache

El cuerpo actual íntegro de `getCategoryNameMap` se extrae a esta función privada **sin
cambios de lógica**: resolver Localiza por `code` `.single()` → leer `vehicle_categories`
por `rental_company_id` con proyección `CATEGORY_NAME_COLUMNS` → construir `Map<code,name>`.
Esto preserva, sin tocarlas, todas las invariantes de #74:

- Filtro por `rental_company_id` resuelto (no `code` global) — respaldado por
  `UNIQUE (rental_company_id, code)` (migración 004).
- Proyección de única fuente `CATEGORY_NAME_COLUMNS = ["code","name"]`.
- Traduce, no filtra: incluye todos los estados (visibilidad es #111, fuera de scope).
- Contrato de error: lanza en error de cualquiera de los dos queries.

### 2. `getCategoryNameMap()` — pública, con cache + single-flight

```ts
let cache: { map: Map<string, string>; expiresAt: number } | null = null;
let inflight: Promise<Map<string, string>> | null = null;
export const CATEGORY_NAME_TTL_MS = 5 * 60_000; // 5 min

export async function getCategoryNameMap(): Promise<Map<string, string>> {
  if (cache && cache.expiresAt > Date.now()) return cache.map; // hit
  if (inflight) return inflight;                                // single-flight
  inflight = fetchCategoryNameMap()
    .then((map) => {
      cache = { map, expiresAt: Date.now() + CATEGORY_NAME_TTL_MS };
      return map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
```

- **Cache hit:** dentro del TTL devuelve el `Map` memoizado sin tocar la BD.
- **Single-flight:** misses concurrentes en cold start comparten una sola promesa
  in-flight → un solo par de queries, no N×2. Correcto contra thundering-herd en Vercel
  Fluid Compute (instancias reutilizadas, concurrencia real).
- **Memo entre requests:** el estado module-level sobrevive en instancias warm de Vercel
  y se auto-cura en cold start (módulo nuevo → `cache`/`inflight` reseteados).

### 3. Estado module-level

`cache`, `inflight`, `CATEGORY_NAME_TTL_MS`. `Date.now()` como fuente de tiempo
(testeable vía `vi.useFakeTimers()`).

## Manejo de errores

Si `fetchCategoryNameMap()` rechaza:

- **Mecanismo:** `.then(onFulfilled)` sin `onRejected` deja pasar la rejection sin tocarla
  → el callback que puebla `cache` **no se ejecuta** → `cache` queda `null` → **el fallo
  NO se cachea**.
- `.finally` limpia `inflight` en ambos caminos (éxito y error) → el próximo request
  **reintenta** (no queda envenenado).
- La rejection se propaga al caller; la degradación segura del route
  (`catch` → sirve lista cruda con 200) se preserva intacta.

**Contrato no-mutar (obligatorio documentar en código):** el `Map` cacheado se comparte
por referencia entre callers (hit y single-flight). Es seguro hoy porque el único
consumidor (`enrichCategoryDescriptions`, `availability-enrichment.ts:18`) solo hace
`nameMap.get(...)`. Pero esa garantía vive en otro archivo sin guard: un futuro caller que
haga `map.set/delete` envenenaría el cache compartido para todos los requests dentro del
TTL (bug silencioso cross-request). **Mitigación:** un comentario en el sitio de retorno de
`getCategoryNameMap` declarando que el `Map` es compartido y los callers NO deben mutarlo.
Se descarta la copia defensiva por-hit (`new Map(cached)`): el consumidor es read-only y
verificado, y copiar introduce inconsistencia de identidad con el path single-flight (los
callers concurrentes comparten la misma promesa/Map). El comentario es la cobertura
proporcional al riesgo real.

## Anclaje del TTL y semántica de borde

- **Anclaje:** `expiresAt = Date.now() + TTL` se computa dentro del `.then`, es decir al
  **completar** el fetch, no al emitir el request. El staleness real medido desde el
  request que dispara el refetch es `≤ TTL + duración_fetch` (~30-80 ms sobre 5 min →
  despreciable). SCEN-010 valida `≤ TTL` con esta precisión.
- **Borde exclusivo:** la guarda es `expiresAt > Date.now()` (estricta). En `t == expiresAt`
  exacto el cache se considera **expirado** (refetch). Implicación para tests: un hit debe
  avanzar el reloj `< TTL`; un refetch debe avanzar `>= TTL`. Avanzar exactamente
  `CATEGORY_NAME_TTL_MS` cae en el borde → refetch.

## Testing

- `vi.useFakeTimers()` controla `Date.now()` para hit/expiry deterministas. Avanzar el
  reloj con `vi.setSystemTime(...)` (absoluto) para evitar el borde exclusivo del TTL.
- `vi.resetModules()` (ya en `beforeEach`) + el re-`import` dentro de `loadModule`
  resetean el estado de módulo (`cache`/`inflight`) entre tests → aislamiento limpio. **NO
  llamar `resetModules` a mitad de un test** (borraría el cache que se está probando).
- Los 7 tests SCEN-007.x existentes siguen verdes (cada uno hace exactamente 1 fetch).
- **Harness para escenarios de 2 fetches (SCEN-010 expiry, SCEN-011 fallo→éxito):** el
  mock actual `createMockSupabase` agota sus dos `.mockReturnValueOnce` con un solo fetch.
  Para un segundo fetch en el **mismo módulo cargado**, rebind `createAdminClient` a un
  **client fresco** antes de la segunda llamada: `vi.mocked(createAdminClient)
  .mockReturnValue(secondClient)`. Funciona porque `fetchCategoryNameMap` invoca
  `createAdminClient()` de nuevo en cada fetch (cachea el `Map`, no el client). Alternativa:
  extender `createMockSupabase` para aceptar N pares de queries y encadenar `2N`
  `mockReturnValueOnce`. Se usa el rebind (más simple, sin tocar el helper compartido).
- **SCEN-012 (single-flight):** emitir ambas llamadas en el **mismo tick síncrono** vía
  `Promise.all([getCategoryNameMap(), getCategoryNameMap()])` y aseverar `from` llamado
  **2 veces** (un fetch), no 4. Como `fetchCategoryNameMap` es `async`, la 1ª llamada fija
  `inflight` y devuelve una promesa pendiente antes de que el mock resuelva su microtask;
  la 2ª entra por `if (inflight) return inflight`. `await getCategoryNameMap(); await
  getCategoryNameMap();` (secuencial) probaría el path de hit, NO single-flight.

## Escenarios observables (holdout para SDD)

- **SCEN-009 (cache hit dentro de TTL):** Dado un primer lookup ya poblado, cuando se
  llama de nuevo antes de que expire el TTL, entonces la BD se consulta **una sola vez**
  (`from` invocado 2 veces en total, no 4) y ambos mapas son iguales.
- **SCEN-010 (expiry refetch + staleness acotado):** Dado un cache poblado, cuando el
  reloj avanza `>= TTL` (borde exclusivo) y las filas subyacentes cambian, entonces el
  siguiente lookup reconsulta la BD y refleja los datos nuevos (staleness ≤ TTL, medido
  desde la completitud del fetch). Requiere rebind a un client fresco (ver Testing).
- **SCEN-011 (fallo no se cachea):** Dado que el primer fetch rechaza, cuando se vuelve a
  llamar, entonces reintenta contra la BD (no devuelve un fallo cacheado) y puede tener
  éxito en el segundo intento. Requiere rebind a un client fresco para el reintento.
- **SCEN-012 (single-flight, cold):** Dadas dos llamadas concurrentes emitidas en el mismo
  tick (`Promise.all`) antes de que la primera resuelva, entonces la BD se consulta **una
  sola vez** (`from` 2 veces, no 4) — ambas comparten la promesa in-flight.
- **SCEN-013 (expirado + concurrente → un solo refetch):** Dado un cache poblado pero
  expirado (`>= TTL`), cuando dos llamadas llegan concurrentes en el mismo tick, entonces
  se hace **un solo refetch** compartido. Pinea el orden de guardas load-bearing
  (chequear `cache` antes que `inflight`): si se invirtiera, el path expirado-concurrente
  regresaría. Observable (con rebind, cada fetch usa su propio client): el `from` del
  **client del refetch** se llama exactamente **2 veces** (un solo refetch compartido), no
  4. Ambas llamadas concurrentes resuelven al mismo `Map` nuevo.

## Decisiones cerradas

- **TTL = 5 min.** Lo propone el issue; staleness aceptable por la política no-rename de
  gamas. Constante exportada para visibilidad/test.
- **Single-flight: sí.** Decisión de alcance aprobada por el usuario; patrón correcto para
  un lookup caro compartido tras requests concurrentes. +1 escenario, ~5 líneas.
- **Sin hook de invalidación.** El issue lo marca como alternativa "si no" basta el TTL.
  La política no-rename hace que el staleness ≤ TTL sea irrelevante en la práctica.
- **Sin colapsar a 1 query (`!inner`).** El cache hace que el número de queries por fetch
  sea secundario; mantener `fetchCategoryNameMap` idéntico minimiza el blast radius y
  preserva las invariantes ya verificadas en #74. (Anotado como posible mejora futura.)

## Relacionado

- #74 (PR #128) — introdujo `getCategoryNameMap`; este es su follow-up de perf.
- #111 — visibilidad de gamas (fuera de scope; el cache traduce, no filtra).
- migración 004 — `UNIQUE (rental_company_id, code)` que sostiene el filtro por empresa.
