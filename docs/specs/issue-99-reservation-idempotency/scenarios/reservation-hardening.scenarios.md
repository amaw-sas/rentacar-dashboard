---
name: reservation-hardening
created_by: claude
created_at: 2026-06-12T00:00:00Z
issue: 99
related: []
---

# Issue #99 — Idempotencia + timeouts en la cadena de creación de reservas

Holdout de comportamiento observable para el endurecimiento de la cadena
`Nuxt → /api/reservations (Vercel) → /api/localiza/reservation (proxy Railway) → Localiza SOAP`
contra reservas fantasma/duplicadas. Diseño en
`docs/specs/2026-06-12-issue-99-reservation-idempotency-design.md`; plan en
`...-plan.md`.

Alcance de ESTE issue: timeouts encadenados (SCEN-3x) + dedupe en el proxy (SCEN-1x).
Fuera de alcance (follow-up): reconciliación del fantasma (Localiza) y submit-guard del
frontend Nuxt.

Convención de IDs: se reusan las etiquetas del diseño (`SCEN-1A`…`SCEN-3C`) como un único
vocabulario across design/plan/scenarios.

Cobertura por step del plan:
- **Step 1** → SCEN-3A + preservación de status no-timeout (502).
- **Step 2** → SCEN-1A/1B/1C/1D (módulo `idempotency` puro).
- **Step 3** → SCEN-1A end-to-end sobre `createReservation` exportada.
- **Step 4** → SCEN-3B (helper) + SCEN-3C (config-lint).
- **Step 5** → SCEN-3B end-to-end (route: 504 + no-insert).

---

## SCEN-3A: timeout del proxy→Localiza se mapea a 504, no a 502

**Given**: una llamada a `callLocalizaAPI(soapAction, xml, { signal })` con un
`AbortController` inyectado, y un `fetch` que **escucha el signal** y rechaza con un
`AbortError` (`DOMException`) cuando se aborta.
**When**: se invoca `controller.abort()` (simula que Localiza no respondió antes de
`LOCALIZA_TIMEOUT_MS`), y el error resultante se pasa por `mapLocalizaError(error, res)`.
**Then**: `callLocalizaAPI` lanza un `LocalizaTimeoutError` (distinguible), y
`mapLocalizaError` responde **HTTP 504** con un payload estructurado
`{ error: "upstream_timeout", message: <texto retry-safe en español> }`.

**Evidence**: tests en `proxy/src/localiza/__tests__/client.test.ts` (el abort produce
`rejects.toBeInstanceOf(LocalizaTimeoutError)`, sin fake timers) y
`proxy/src/localiza/__tests__/errors.test.ts` (`mapLocalizaError(new LocalizaTimeoutError(...))`
fija `res.status === 504` y `res.json.error === "upstream_timeout"`). Red verificado: sin
el seam de timeout, un `AbortError` cae a la rama genérica y devuelve 502.

## SCEN-3A-PRESERVE: un error de upstream NO-timeout sigue devolviendo 502

**Given**: `mapLocalizaError(error, res)` recibe un `Error` genérico (no
`LocalizaWarningError`, no `LocalizaTimeoutError`) — el caso de una falla real de
infra/parseo de Localiza.
**When**: se llama `mapLocalizaError`.
**Then**: responde **HTTP 502** con `{ error: <error.message> }`, idéntico al
comportamiento actual de los tres endpoints (`reservation`, `availability`, `check-status`),
preservando la semántica pre-existente para todo lo que no sea un timeout.

**Evidence**: test en `errors.test.ts` — `mapLocalizaError(new Error("boom"), res)` →
`res.status === 502`, `res.json.error === "boom"`. Y un `LocalizaWarningError` →
`res.status === error.httpStatus` con `toJSON()`. Red verificado: si el genérico devolviera
500 (o el warning se rompe), este assert falla.

## SCEN-1A: dos requests idénticos concurrentes hacen UNA sola reserva en Localiza

**Given**: el módulo de idempotencia del proxy y una `fn` que representa la llamada real a
Localiza (un spy con un deferred manual, aún sin resolver).
**When**: llegan dos invocaciones con el **mismo** fingerprint de booking (mismo documento,
sedes, fechas y categoría) antes de que la primera resuelva
(`withIdempotency(key, fn)` ×2 concurrente).
**Then**: `fn` se ejecuta **exactamente una vez** (coalescing); cuando el deferred resuelve,
ambas promesas reciben el **mismo** `reserveCode`.

**Evidence**: test en `proxy/src/localiza/__tests__/idempotency.test.ts` — spy de `fn` con
`toHaveBeenCalledTimes(1)` para dos llamadas concurrentes con la misma clave; ambos resultados
`===`. Red verificado: sin el registro in-flight, `fn` se llama 2×.

## SCEN-1B: replay dentro del TTL devuelve el resultado sin llamar a Localiza

**Given**: una reserva completada con éxito hace menos de `DEDUPE_TTL_MS`, cacheada bajo su
fingerprint.
**When**: llega un request idéntico (mismo fingerprint) dentro de la ventana TTL.
**Then**: se devuelve el `reserveCode` cacheado con **cero** ejecuciones nuevas de `fn`.

**Evidence**: test en `idempotency.test.ts` — primera llamada resuelve y cachea; segunda
llamada (reloj `< TTL`) → spy de `fn` sigue en `toHaveBeenCalledTimes(1)`; resultado igual al
primero. Red verificado: sin cache de éxito, la segunda llamada ejecuta `fn` otra vez (2×).

## SCEN-1C: un fallo NO se cachea — un request posterior reintenta fresco

**Given**: un primer request cuya `fn` rechaza (timeout o error de Localiza).
**When**: tras el rechazo, llega un request posterior con el mismo fingerprint.
**Then**: el request posterior **re-ejecuta** `fn` (no hereda el fallo cacheado). Además, los
waiters **concurrentes** acoplados al primer in-flight comparten ese mismo rechazo (no se
re-ejecuta para ellos), pero la entrada in-flight se limpia al rechazar para que la siguiente
llegada reintente.

**Evidence**: test en `idempotency.test.ts` con un deferred manual: (a) dos llamadas
concurrentes comparten el reject (spy `fn` 1×); (b) una tercera llamada posterior re-ejecuta
(spy `fn` pasa a 2×) y puede resolver. Red verificado: cachear en el path de rechazo hace que
(b) devuelva el fallo y no reintente.

## SCEN-1D: el header `Idempotency-Key` se COMBINA con el fingerprint, no lo reemplaza

**Given**: `deriveKey(body, headerKey?)`.
**When**: se derivan claves para combinaciones de body y header.
**Then**:
- mismo header + mismo body → **misma** clave (deduplican);
- mismo body + headers **distintos** → claves **distintas** (no deduplican: el cliente señala
  intentos distintos);
- mismo header + bodies **distintos** → claves **distintas** (nunca devuelve una reserva
  equivocada).
Además el fingerprint es estable (mismo input → misma clave), sensible a la intención (otro
documento/fecha/categoría/sede → otra clave) e **insensible a artefactos de cotización**
(`referenceToken` distinto → MISMA clave; `rateQualifier` distinto → MISMA clave).

**Evidence**: tests en `idempotency.test.ts` que comparan los hex de `deriveKey` para cada
combinación. Red verificado: si el header reemplazara el fingerprint, "mismo header + bodies
distintos" colapsaría a la misma clave; si el fingerprint incluyera `referenceToken`/
`rateQualifier`, "artefacto distinto" produciría claves distintas y rompería el dedupe del
reload.

## SCEN-3B: timeout del dashboard→proxy devuelve error retry-safe SIN insertar fila

**Given**: el handler `/api/reservations` en el camino de reserva estándar
(`selected_days < 30`), con `createLocalizaReservation` que rechaza con `ProxyTimeoutError`
(simula que el proxy excedió `PROXY_TIMEOUT_MS`).
**When**: se procesa el POST.
**Then**: la respuesta es **HTTP 504** con `{ error: "upstream_timeout", message: <texto
retry-safe> }`, y **`insert` NUNCA se invoca** en Supabase (cero fila creada → cero fantasma
del lado nuestro). El helper `createLocalizaReservation`, con un `AbortController` inyectado
abortado, lanza `ProxyTimeoutError` y reenvía el header `Idempotency-Key` cuando se le pasa.

**Evidence**: (a) `tests/unit/reservation/proxy-client.test.ts` — abort del signal inyectado
→ `rejects.toBeInstanceOf(ProxyTimeoutError)`; el `fetch` mock captura headers y confirma
`Idempotency-Key` presente/ausente según `opts.idempotencyKey`. (b) ampliación de
`tests/unit/api/reservations-route.test.ts` — `createLocalizaReservation` mockeado rechaza con
`ProxyTimeoutError` en un body de path estándar → `res.status === 504`, `error ===
"upstream_timeout"`, y `sb.insert` con `not.toHaveBeenCalled()`. Red verificado: el código
actual cuelga hasta el 504 duro de Vercel; sin la rama de timeout no hay 504 estructurado.

## SCEN-3C: invariante de escalonamiento de timeouts (config-lint)

**Given**: las constantes de timeout del dashboard exportadas por
`lib/reservation/proxy-client.ts` (`PROXY_TIMEOUT_MS`, `MAX_DURATION_S`).
**When**: se evalúan.
**Then**: `PROXY_TIMEOUT_MS < MAX_DURATION_S * 1000` — el fetch al proxy aborta limpio antes
de que Vercel mate la función por `maxDuration`. (El par cross-proceso
`LOCALIZA_TIMEOUT_MS < PROXY_TIMEOUT_MS` se garantiza por defaults 25000<28000 y se documenta
en `.env*.example`, porque viven en deployables distintos y un test in-process no los ve a la vez.)

**Evidence**: assert en `tests/unit/reservation/proxy-client.test.ts`:
`expect(PROXY_TIMEOUT_MS).toBeLessThan(MAX_DURATION_S * 1000)`. Es una guarda contra una
edición futura que rompa el escalonamiento, no una observación de runtime.
