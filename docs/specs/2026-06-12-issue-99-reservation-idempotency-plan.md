# Issue #99 — Plan de implementación: idempotencia + timeouts

**Fecha:** 2026-06-12
**Spec base:** `docs/specs/2026-06-12-issue-99-reservation-idempotency-design.md`
**Branch/worktree:** `task/issue-99-reservation-idempotency` / `.worktrees/issue-99-reservation-idempotency`
**Sin cambios de DB / sin migración.**

## Mapa de archivos (decisiones de descomposición)

### Proxy (`proxy/src/localiza/`)
| Archivo | Estado | Responsabilidad única |
|---------|--------|------------------------|
| `errors.ts` | **NUEVO** | `LocalizaTimeoutError` (clase) + `mapLocalizaError(error, res)` — único punto que traduce errores de Localiza a status HTTP: `LocalizaWarningError`→`httpStatus`, `LocalizaTimeoutError`→504 estructurado, genérico→502. Importa `LocalizaWarningError` de `warnings.ts`. |
| `client.ts` | MOD | `callLocalizaAPI(action, xml, opts?: { signal?: AbortSignal })`: usa `opts.signal ?? AbortSignal.timeout(LOCALIZA_TIMEOUT_MS)` en el `fetch`; en `AbortError`/`TimeoutError` (`DOMException`) lanza `LocalizaTimeoutError`. **Signal inyectable** = seam de test (ver nota de testabilidad). Lee `LOCALIZA_TIMEOUT_MS` de env (default 25000). |
| `idempotency.ts` | **NUEVO** | `deriveKey(body, headerKey?)` (fingerprint de intención + header combinado) + `withIdempotency(key, fn)` (coalescing in-flight + cache TTL de éxito + no-poison). Store en memoria module-scoped. Función pura, sin Express. |
| `reservation.ts` | MOD | Extrae el núcleo del handler a `export async function createReservation(data, headerKey?)` que deriva la clave y envuelve la lógica en `withIdempotency`; el `router.post` queda como cáscara (valida campos → llama `createReservation` → `mapLocalizaError` en catch). El **export** es el seam de test. |
| `availability.ts` | MOD | Reemplaza su catch por `mapLocalizaError` (hereda timeout→504; hoy cae a 500/502 genérico). |
| `check-status.ts` | MOD | Reemplaza su catch por `mapLocalizaError`. |
| `__tests__/idempotency.test.ts` | **NUEVO** | SCEN-1a/b/c/d + estabilidad/sensibilidad del fingerprint. |
| `__tests__/client.test.ts` | **NUEVO** | SCEN-3a — timeout de `callLocalizaAPI` vía `AbortController` inyectado (sin fake timers). |
| `__tests__/errors.test.ts` | **NUEVO** | `mapLocalizaError` mapea cada tipo al status correcto. |

### Dashboard
| Archivo | Estado | Responsabilidad única |
|---------|--------|------------------------|
| `lib/reservation/proxy-client.ts` | **NUEVO** | `createLocalizaReservation(payload, opts?: { idempotencyKey?: string; signal?: AbortSignal })`: `fetch` al proxy con `opts.signal ?? AbortSignal.timeout(PROXY_TIMEOUT_MS)`, reenvía `Idempotency-Key`, devuelve `{reserveCode, reservationStatus}` o lanza `ProxyTimeoutError` / propaga el error estructurado del proxy. **Signal inyectable** = seam de test. Exporta constantes `PROXY_TIMEOUT_MS` (default 28000) y `MAX_DURATION_S` (30). Aísla la lógica de red+timeout del handler para hacerla testeable. |
| `app/api/reservations/route.ts` | MOD | `export const maxDuration = MAX_DURATION_S`; llama a `createLocalizaReservation`; reenvía el header entrante; mapea `ProxyTimeoutError`→504 retry-safe; **no inserta** en el path de fallo (ya es así). |
| `tests/unit/reservation/proxy-client.test.ts` | **NUEVO** | SCEN-3b (timeout→error retry-safe, sin insert) + reenvío del header + config-lint SCEN-3c (`PROXY_TIMEOUT_MS < MAX_DURATION_S*1000`). |
| `.env.local.example`, `.env.staging.example` | MOD | Documentar `LOCALIZA_TIMEOUT_MS`, `PROXY_TIMEOUT_MS`, `DEDUPE_TTL_MS` (opcionales con default). |

> **Nota sobre SCEN-3c (invariante de 3 valores):** las tres constantes viven en **dos procesos distintos** (`LOCALIZA_TIMEOUT_MS` en el proxy; `PROXY_TIMEOUT_MS` + `maxDuration` en el dashboard). Un test in-process solo puede afirmar el par que ve. → El config-lint del dashboard afirma `PROXY_TIMEOUT_MS < MAX_DURATION_S*1000`. El par cross-proceso `LOCALIZA_TIMEOUT_MS < PROXY_TIMEOUT_MS` se garantiza por los **defaults** (25000 < 28000) y se documenta en los `.env*.example` de ambos. No es falla del diseño: es la realidad de dos deployables separados.

## Prerequisitos
- **`pnpm install` en la raíz del repo PRIMERO** — el worktree no tiene `node_modules`; `../node_modules/.bin/vitest` (que usa el proxy) hoy NO existe. Sin esto ningún test corre.
- Ninguna dependencia nueva (Node ≥18 trae `AbortSignal.timeout`; `crypto` nativo para el hash del fingerprint; no se añade `supertest` — los seams exportados evitan necesitarlo).
- El proxy tiene su propio `proxy/vitest.config.ts` (`environment: node`, `include: src/**/__tests__/**`); el binario vitest se toma prestado del root install, pero la **config** es la local del proxy (node env, sin jsdom — lo correcto).

## Nota de testabilidad — `AbortSignal.timeout` no es controlable con fake timers
`AbortSignal.timeout()` usa un timer interno del host (no un `setTimeout` JS observable), así que `vi.useFakeTimers()` + `vi.advanceTimersByTime()` **no** lo disparan → un test que "avanza el tiempo" se colgaría. Por eso `callLocalizaAPI` y `createLocalizaReservation` aceptan un **`signal` inyectable**: en producción usan `AbortSignal.timeout(...)` por default; en test se inyecta un `AbortController` y se llama `controller.abort()` para verificar el mapeo `AbortError → LocalizaTimeoutError/ProxyTimeoutError`. Sin fake timers. (No hay precedente de test de timeout en el repo — `lib/ghl/client.ts` usa `AbortSignal.timeout` sin test; este seam lo habilita.)

## Steps

### Fase 1 — Proxy: timeouts y mapeo de errores

**Step 1 — `LocalizaTimeoutError` + timeout en `callLocalizaAPI` + `mapLocalizaError` compartido**
`Size: M | Dependencias: none`
- Crear `proxy/src/localiza/errors.ts`: clase `LocalizaTimeoutError extends Error` y `mapLocalizaError(error, res)`.
- En `client.ts`: firma `callLocalizaAPI(action, xml, opts?)`; usar `opts?.signal ?? AbortSignal.timeout(Number(process.env.LOCALIZA_TIMEOUT_MS ?? 25000))`; relanzar `AbortError`/`TimeoutError` (`DOMException`) como `LocalizaTimeoutError`.
- Cablear `mapLocalizaError` en los catch de `reservation.ts`, `availability.ts`, `check-status.ts`. **Orden y comportamiento PRESERVANTE:** `LocalizaWarningError → error.httpStatus`; `LocalizaTimeoutError → 504` estructurado; **genérico → 502** (los tres endpoints hoy devuelven 502 para error de upstream — el genérico se fija en **502**, no 500). `check-status` hoy no produce `LocalizaWarningError`: gana una rama de warning **inalcanzable** (inocua, documentada).
- **Escenario (SCEN-3a):** Given Localiza no responde antes del timeout (simulado abortando un `AbortController` inyectado), When el signal dispara, Then `callLocalizaAPI` lanza `LocalizaTimeoutError` y `mapLocalizaError` responde 504 estructurado.
- **Criterios de aceptación:**
  - `__tests__/client.test.ts`: inyectar `AbortController`; el `fetch` mock debe **escuchar el signal** (`signal.addEventListener("abort", () => reject(new DOMException("aborted","AbortError")))`), no un `mockRejectedValue` pelado (eso no prueba el wiring); `controller.abort()` → `expect(callLocalizaAPI(..., {signal})).rejects.toBeInstanceOf(LocalizaTimeoutError)`. **Sin fake timers.**
  - `__tests__/errors.test.ts`: `mapLocalizaError` con (a) `LocalizaWarningError`→`httpStatus`, (b) `LocalizaTimeoutError`→504, (c) **`new Error("x")` → 502 `{error:"x"}`** (prueba de preservación del path no-timeout para los tres endpoints).
  - `(cd proxy && npm test)` verde; los tests existentes del proxy siguen pasando.

### Fase 2 — Proxy: dedupe

**Step 2 — Módulo `idempotency.ts` (puro, sin Express)**
`Size: M | Dependencias: none`
- `deriveKey(body, headerKey?)`: fingerprint = hash SHA-256 (hex) de los campos de intención ordenados canónicamente `{customerDocument, pickupLocation, returnLocation, pickupDateTime, returnDateTime, categoryCode}`. Si `headerKey` presente → `key = sha256(headerKey + ":" + fingerprint)`; si no → `fingerprint`.
- `withIdempotency(key, fn)`: si hay entrada in-flight para `key` → retornar su promesa (coalescing). Si hay éxito cacheado y no expiró (`DEDUPE_TTL_MS`, default 60000) → retornarlo sin llamar `fn`. Si no → ejecutar `fn`, registrar in-flight; al resolver, cachear con `expiresAt` y limpiar in-flight; al rechazar, limpiar in-flight **sin** cachear. Expiry perezoso al consultar.
- **Escenarios (SCEN-1a/b/c/d):** coalescing concurrente → 1 sola ejecución de `fn`, mismo resultado; replay <TTL → 0 ejecuciones; fallo no se cachea → llamada posterior re-ejecuta; header combinado: mismo key+body→dedup, mismo body+keys distintos→no-dedup, mismo key+body distinto→no-colapsa.
- **Criterios de aceptación:** `__tests__/idempotency.test.ts` cubre los 4 escenarios + fingerprint estable (mismo input→misma clave), sensible (campo de intención distinto→clave distinta) e **insensible a artefactos** (`referenceToken` distinto→MISMA clave; `rateQualifier` distinto→MISMA clave, casos separados). `fn` se cuenta con un spy. **Determinismo:** usar un **deferred manual** (promesa con `resolve`/`reject` expuestos) como `fn` para ordenar las 3 llegadas de SCEN-1c (dos waiters acoplados comparten el reject; la 3ª llegada, tras limpiar el in-flight, re-ejecuta) sin depender de timing. Tests verdes.

**Step 3 — Extraer `createReservation` y cablear `idempotency` en `reservation.ts`**
`Size: M | Dependencias: Step 2`
- Extraer el núcleo del handler a `export async function createReservation(data, headerKey?)`: `const key = deriveKey(data, headerKey)`; envolver `getConfig→buildVehResXML→callLocalizaAPI→extractReservation` en `withIdempotency(key, async () => {...})`; devolver `{reserveCode, reservationStatus}`. El `router.post` queda como cáscara: valida campos requeridos (400) → `createReservation(data, req.header("x-idempotency-key"))` → `res.json(...)` → catch con `mapLocalizaError`.
- **Escenario (SCEN-1a end-to-end):** Given dos invocaciones idénticas concurrentes de `createReservation`, When la segunda llega antes de que la primera resuelva, Then `callLocalizaAPI` se invoca **una sola vez** y ambas reciben el mismo `reserveCode`.
- **Criterios de aceptación:** test sobre la función **exportada** `createReservation` (mockeando `callLocalizaAPI` con un spy) — dos llamadas concurrentes → spy llamado 1 vez, mismo resultado. **Sin `supertest`** (el export es el seam). Verificar que el `router.post` mantiene el 400 de campos faltantes (test directo de la cáscara o assertion del validador). Tests verdes.

### Fase 3 — Dashboard: timeout y propagación

**Step 4 — `lib/reservation/proxy-client.ts` (helper testeable) + constantes**
`Size: M | Dependencias: none`
- `createLocalizaReservation(payload, opts?: {idempotencyKey?: string; signal?: AbortSignal})`: `fetch` al proxy con `opts?.signal ?? AbortSignal.timeout(PROXY_TIMEOUT_MS)` y header `Idempotency-Key` si viene; en `!ok` propaga el error estructurado del proxy (igual que hoy); en `AbortError` lanza `ProxyTimeoutError`. Exporta `PROXY_TIMEOUT_MS`, `MAX_DURATION_S`.
- **Escenarios (SCEN-3b, SCEN-3c):** proxy no responde → `ProxyTimeoutError`; header se reenvía; invariante `PROXY_TIMEOUT_MS < MAX_DURATION_S*1000`.
- **Criterios de aceptación:** `tests/unit/reservation/proxy-client.test.ts`:
  - inyectar `AbortController`; `fetch` mock que **escucha el signal** (registra listener `abort` → rechaza con `AbortError`), no `mockRejectedValue` pelado; `controller.abort()` → `rejects.toBeInstanceOf(ProxyTimeoutError)` (**sin fake timers**);
  - `fetch` mock que captura el segundo argumento → assert que `headers["Idempotency-Key"]` se envía cuando `opts.idempotencyKey` está presente, y ausente cuando no;
  - assert del config-lint `PROXY_TIMEOUT_MS < MAX_DURATION_S*1000`.
  Tests verdes.

**Step 5 — Integrar en `route.ts` + `maxDuration` + error retry-safe**
`Size: M | Dependencias: Step 4`
- `export const maxDuration = MAX_DURATION_S`. Reemplazar el bloque `fetch(...)` inline por `createLocalizaReservation(...)`, pasando `idempotencyKey: request.headers.get("x-idempotency-key") ?? undefined`. En `catch`/rama de `ProxyTimeoutError` → `NextResponse.json({error:"upstream_timeout", message:"El sistema de reservas está demorando más de lo normal. Tu reserva NO se creó; espera unos minutos e inténtalo de nuevo."}, {status:504})`. Confirmar que **no** hay `insert` en ese camino.
- **Escenario (SCEN-3b end-to-end):** Given `createLocalizaReservation` lanza `ProxyTimeoutError`, When `/api/reservations` lo maneja, Then responde el payload `upstream_timeout` (504) y **no** invoca `insert`.
- **Criterios de aceptación:** ampliar `tests/unit/api/reservations-route.test.ts` (ya existe y mockea la cadena Supabase): un caso donde `createLocalizaReservation` (mockeado) rechaza con `ProxyTimeoutError` → assert status 504 + `error:"upstream_timeout"` y que `from().insert` **nunca** se invocó (observable, no eyeballed). `pnpm type-check` y `pnpm lint` verdes; resto de tests del dashboard siguen pasando.

### Fase 4 — Documentación de configuración

**Step 6 — Documentar env vars**
`Size: S | Dependencias: Steps 1, 4`
- Añadir a `.env.local.example` y `.env.staging.example`: `LOCALIZA_TIMEOUT_MS` (proxy), `PROXY_TIMEOUT_MS`, `DEDUPE_TTL_MS` con sus defaults y una línea que documente el invariante `LOCALIZA_TIMEOUT_MS < PROXY_TIMEOUT_MS < maxDuration(30s)`.
- **Criterios de aceptación:** las tres vars presentes con comentario del invariante; `git diff` legible.

## Testing Strategy
- **Unit (proxy, vitest):** `idempotency.test.ts`, `client.test.ts`, `errors.test.ts`, test de `createReservation` exportada. Timeouts vía `AbortController` inyectado (NO fake timers); TTL del dedupe vía fake timers o `expiresAt` inyectable.
- **Unit (dashboard, vitest):** `proxy-client.test.ts` (timeout vía signal inyectado, header, invariante) + ampliación de `reservations-route.test.ts` (504 + no-insert).
- **Gate CI dashboard:** `type-check → lint → test → build`.
- **Gate proxy:** `(cd proxy && npm test)` (no está en CI; correr local).
- **Runtime end-to-end** por el funnel Nuxt: cross-repo + requiere credenciales Localiza vivas → verificación manual documentada en el PR, no bloquea.

## Rollout Plan
- **Deploy:** dashboard → Vercel (push de la branch → preview); proxy → Railway (deploy de su servicio). Ambos toman defaults si las env vars no se setean → seguro sin configuración extra.
- **Tuning sin redeploy de código:** ajustar `*_TIMEOUT_MS`/`DEDUPE_TTL_MS` por env var en cada plataforma.
- **Monitoreo:** logs Railway del proxy (`localiza_upstream_*`, nuevos timeouts) y runtime logs de Vercel para `upstream_timeout`.
- **Rollback:** revertir el merge; sin estado persistente que migrar (dedupe es in-memory, se descarta limpio).

## Open Questions / Follow-ups
- **SCEN-2 (reconciliación del fantasma):** follow-up; requiere confirmar si Localiza permite buscar reserva por reference.
- **SCEN-4 (submit-guard):** repo `rentacar-reserva` (Nuxt), cambio pareado.
- Si el proxy llegara a escalar a >1 réplica, migrar el dedupe a store compartido.
