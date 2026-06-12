# Issue #99 — Idempotencia + timeouts en la cadena de creación de reservas

**Fecha:** 2026-06-12
**Issue:** #99 — `fix(reservations): idempotencia + anti-doble-submit para evitar reservas fantasma/duplicadas en Localiza`
**Alcance:** dashboard + proxy. El submit-guard del frontend Nuxt (`rentacar-reserva`) es repo separado.

## Problema

Crear una reserva atraviesa tres saltos sin timeout, sin idempotencia y sin guarda anti-doble-submit:

```
rentacar-reserva (Nuxt)
  → POST /api/reservations            (Vercel — app/api/reservations/route.ts)
    → POST /api/localiza/reservation  (proxy Railway — proxy/src/localiza/reservation.ts)
      → Localiza SOAP (tras Akamai)   (proxy/src/localiza/client.ts → callLocalizaAPI)
```

Cuando Localiza se pone lento, la cadena se cuelga hasta que una capa expira con 504, el operador recarga y reenvía, y peticiones solapadas pueden **corromper la transacción de Localiza** o crear una **reserva fantasma/duplicada**. Incidente de referencia: 2026-06-04 (memoria `incident_reservation_slow_504_double_submit_2026_06_04`). En ese incidente no quedó fantasma, pero el desenlace de un 504 de gateway es **no determinista** — el riesgo estructural sigue.

### Por qué un 504 es peligroso, no solo molesto

Un `504` de Akamai significa "el gateway se rindió", **no** "Localiza no hizo nada". El origen pudo completar la reserva después del timeout. El proxy lanza excepción en el 504 y nunca lee el `ConfID` → la reserva queda **huérfana en Localiza, invisible para nosotros**. Es integridad de datos, no solo UX.

## Alcance de este PR (decisiones cerradas en brainstorming)

| # | Decisión | Resultado |
|---|----------|-----------|
| 1 | Alcance | **Timeouts (SCEN-3) + dedupe en proxy (SCEN-1)** ahora. Reconciliación del fantasma (SCEN-2) → **follow-up** (bloqueada por capacidad Localiza no confirmada). Submit-guard (SCEN-4) → repo Nuxt. |
| 2 | Fuente de la clave de idempotencia | **Fingerprint derivado de los campos del booking + header `Idempotency-Key` opcional** (forward-compatible). Funciona hoy sin tocar el frontend. |
| 3 | Store del dedupe | **Mapa TTL en memoria** en el proxy (coalescing in-flight + cache corto del resultado). Proxy es single-instance confirmado (`railway.toml` sin réplicas). |

### Por qué SCEN-2 se difiere

`check-status` busca en Localiza por `reservationCode` (UniqueID Type=14). En un 504 **nunca obtuvimos ese código**. Localiza solo echoea el `Reference` Type=41 (`referenceToken`) en el request; **no hay operación SOAP confirmada de "buscar reserva por reference"**. Reconciliar el fantasma requiere una capacidad de Localiza que hoy no está verificada. Se difiere a un follow-up que primero investigue la API real de Localiza.

### Por qué el dedupe vive en el proxy y no en el dashboard

El proxy es el **único choke-point single-instance** hacia Localiza. El route handler de Vercel corre en Fluid Compute con múltiples instancias → estado en memoria ahí no es confiable para deduplicar. El proxy ve todo el tráfico hacia Localiza por una sola instancia.

## Arquitectura — los tres timeouts encadenados

```
Nuxt → POST /api/reservations (Vercel)
          maxDuration = 30s
          AbortSignal.timeout(PROXY_TIMEOUT_MS = 28s)  ──┐
       → POST /api/localiza/reservation (proxy Railway)  │  28 < 30
            idempotency wrapper (dedupe)                  │
            AbortSignal.timeout(LOCALIZA_TIMEOUT_MS=25s) ─┘  25 < 28
          → Localiza SOAP
```

**Invariante:** `LOCALIZA_TIMEOUT (25s) < PROXY_TIMEOUT (28s) < maxDuration (30s)`. Cada capa falla limpio **antes** de que la de arriba la mate con un 504 duro. Los tres valores son env vars con esos defaults.

## Componentes

### 1. Proxy — timeout en `callLocalizaAPI` (`proxy/src/localiza/client.ts`)

Añade `signal: AbortSignal.timeout(LOCALIZA_TIMEOUT_MS)` al `fetch`. Cuando el signal dispara, `fetch` lanza un `AbortError` (`DOMException` con `name === "AbortError"`); lo traducimos a un error distinguible `LocalizaTimeoutError` para que el endpoint pueda mapearlo a un 504 estructurado en vez del 502 genérico.

`LOCALIZA_TIMEOUT_MS` se lee de env (default 25000). Como `callLocalizaAPI` es compartido, **availability y check-status también ganan un techo de latencia** sin cambiar su contrato — beneficio colateral, riesgo bajo.

### 2. Proxy — módulo nuevo `proxy/src/localiza/idempotency.ts`

Store en memoria con tres responsabilidades, expuesto como `withIdempotency(key, fn)`:

- **`deriveKey(body, headerKey?)`** — si llega header `Idempotency-Key`, esa **es** la clave (gana sobre el fingerprint). Si no, hash canónico estable de los campos que definen el booking: `{customerDocument, pickupLocation, returnLocation, pickupDateTime, returnDateTime, categoryCode, referenceToken}`. El orden de las claves se normaliza antes de hashear para que el fingerprint sea determinista.
- **In-flight coalescing** — `Map<key, Promise<Result>>`. Si una clave está en vuelo, un duplicado concurrente **espera la misma promesa** → una sola llamada a Localiza, mismo `reserveCode` para ambos.
- **Replay de éxito** — `Map<key, {result, expiresAt}>` con TTL `DEDUPE_TTL_MS` (default 60000). Un hit dentro del TTL devuelve el resultado cacheado **sin** llamar a Localiza.

**No envenenar:** los **fallos NO se cachean**. Al rechazar `fn`, se desregistra el in-flight y no se persiste nada → un reintento legítimo posterior procede con una llamada fresca. Solo los éxitos entran al cache TTL.

Solo envuelve el endpoint **mutante** (`reservation`). `availability` y `check-status` son lecturas — no se deduplican.

Limpieza: entradas expiradas se purgan perezosamente al consultarse (lazy expiry); no se introduce un timer de fondo (innecesario para un store de baja cardinalidad y vida corta).

**Salvedad documentada:** el store se pierde en reinicio/escalado del proxy. Aceptable dado el modelo de amenaza (ventana de segundos del reload+resubmit) y el proxy single-instance. Si el proxy escalara a múltiples réplicas, este dedupe dejaría de cubrir el cruce entre instancias y habría que migrar a un store compartido (Redis/Upstash) — fuera de alcance hoy.

### 3. Dashboard — `app/api/reservations/route.ts`

- `export const maxDuration = 30` (route segment config de Next.js App Router; más limpio que una entrada por-path en `vercel.json`).
- `AbortSignal.timeout(PROXY_TIMEOUT_MS)` en el `fetch` al proxy (default 28000).
- Reenvía el header `Idempotency-Key` entrante si existe (forward-compat; el proxy deriva fingerprint igual cuando no viene).
- En `AbortError` (nuestro timeout disparó) → responde error estructurado retry-safe (504) en vez de colgar; distinto del 502 genérico actual.
- **No inserta en DB en el camino de fallo/timeout** (ya es el comportamiento actual: solo inserta en el path de éxito) → cero fantasma del lado nuestro.

### 4. Feedback retry-safe al usuario (SCEN-5, lado servidor)

El proxy (en timeout) y el route devuelven un payload estructurado:

```json
{ "error": "upstream_timeout",
  "message": "El sistema de reservas está demorando más de lo normal. Tu reserva NO se creó; espera unos minutos e inténtalo de nuevo." }
```

El render del toast es del frontend Nuxt (ya sabe manejar `{error, message}` estructurado vía `useMessages.createErrorMessage`). Aquí solo proveemos el mensaje retry-safe.

## Escenarios observables

| ID | Given | When | Then |
|----|-------|------|------|
| **SCEN-1a** (coalescing) | Reserva R en vuelo en el proxy | Llega R' con fingerprint idéntico antes de que R resuelva | R' espera a R; ambos reciben el **mismo** `reserveCode`; se hace **1 sola** llamada a Localiza |
| **SCEN-1b** (replay) | R completó con éxito hace < TTL | Llega R' idéntico | R' devuelve el `reserveCode` cacheado con **0** llamadas a Localiza |
| **SCEN-1c** (no-poison) | R falló (timeout o error) | Llega R' idéntico después | R' hace una llamada **fresca** a Localiza (el fallo no se cacheó) |
| **SCEN-1d** (header gana) | Dos requests con el mismo `Idempotency-Key` explícito pero campos de body distintos | Llega el segundo | Se tratan como el mismo intento (la clave explícita manda) |
| **SCEN-3a** (timeout proxy→Localiza) | Localiza supera `LOCALIZA_TIMEOUT_MS` | El `AbortSignal` dispara | `callLocalizaAPI` lanza `LocalizaTimeoutError`; el endpoint responde **504** estructurado, bajo cualquier kill duro |
| **SCEN-3b** (timeout dashboard→proxy) | El proxy supera `PROXY_TIMEOUT_MS` | El `AbortSignal` del dashboard dispara | `/api/reservations` responde error retry-safe en < `maxDuration` y **NO inserta** fila en DB |
| **SCEN-3c** (invariante de config) | Las constantes de timeout | Se evalúan | `LOCALIZA_TIMEOUT < PROXY_TIMEOUT < maxDuration` se cumple |

## Estrategia de satisfacción (testing)

- **Proxy (vitest, ya configurado en `proxy/`):**
  - `idempotency.test.ts` — coalescing (SCEN-1a), replay TTL (SCEN-1b), fallo-no-cachea (SCEN-1c), precedencia de header (SCEN-1d), estabilidad del fingerprint (mismo input → misma clave; campo distinto → clave distinta).
  - `client.test.ts` (o ampliar existente) — timeout de `callLocalizaAPI`: mock de `fetch` que nunca resuelve + signal abortado → lanza `LocalizaTimeoutError` (SCEN-3a). Usar fake timers de vitest.
- **Dashboard (vitest):**
  - Extraer el call+timeout al proxy a un helper pequeño y testeable; verificar que un proxy que excede el timeout produce el error retry-safe sin insertar (SCEN-3b) y que el header `Idempotency-Key` se reenvía.
  - Test del invariante de constantes (SCEN-3c).
- **Runtime end-to-end** por el funnel Nuxt: cross-repo y externo (requiere credenciales Localiza vivas) → verificación manual documentada, **no** bloquea el PR. La memoria advierte que no se pueden probar integraciones con env de prod pulled (`vercel env pull` devuelve vacío para vars Sensitive).

## Blast radius

| Archivo | Cambio |
|---------|--------|
| `proxy/src/localiza/client.ts` | + timeout compartido en el fetch; nuevo `LocalizaTimeoutError`. Toca availability/reservation/check-status (solo añade techo). |
| `proxy/src/localiza/reservation.ts` | Envuelve la lógica de reserva en `withIdempotency`; deriva la clave del body + header. |
| `proxy/src/localiza/idempotency.ts` | **NUEVO** — store de dedupe. |
| `proxy/src/localiza/__tests__/idempotency.test.ts` | **NUEVO** — tests. |
| `proxy/src/localiza/__tests__/client.test.ts` | **NUEVO/ampliar** — test de timeout. |
| `app/api/reservations/route.ts` | + `maxDuration`, `AbortSignal.timeout`, forward del header, error limpio en `AbortError`. |
| `.env.local.example`, `.env.staging.example`, proxy env docs | Documentar `LOCALIZA_TIMEOUT_MS`, `PROXY_TIMEOUT_MS`, `DEDUPE_TTL_MS` (todas opcionales con default). |

**Consumidores:** el frontend Nuxt no rompe — la respuesta de éxito es idéntica; el error de timeout es estructurado y ya se maneja. **Sin cambios de DB / sin migración.**

## Fuera de alcance

- **SCEN-2 (reconciliación del fantasma)** — follow-up; requiere investigar si Localiza permite buscar reserva por reference.
- **SCEN-4 (submit-guard + protección de reload)** — repo `rentacar-reserva` (Nuxt), cambio pareado coordinado aparte.
- **Timeout del fetch de availability en el dashboard** — ya queda protegido por el techo de `callLocalizaAPI` en el hop del proxy; no se añade AbortSignal en el dashboard para mantener el PR enfocado.
- **Store compartido (Redis)** — innecesario para el proxy single-instance actual.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Fingerprint demasiado laxo deduplica reservas legítimamente distintas | El fingerprint incluye `referenceToken` (único por cotización/availability) además de documento+sedes+fechas+categoría; dos reservas genuinamente distintas difieren en al menos un campo. TTL corto (60s) acota la ventana. |
| Fingerprint demasiado estricto no deduplica el reload+resubmit | El reload reenvía el mismo body (mismos campos) → mismo fingerprint. Verificado contra el shape real del payload del frontend. |
| Cachear un fallo bloquea reintentos legítimos | Diseño explícito: solo se cachean éxitos; los fallos se desregistran. |
| Timeout muy agresivo corta reservas lentas pero válidas | Valores generosos (25/28/30s) y env-tunables; suben sin redeploy de código. |
| El store se pierde al reiniciar el proxy | Aceptado: ventana de amenaza es de segundos; un reinicio justo en esa ventana es improbable y el peor caso degrada al comportamiento actual (sin dedupe), no a algo peor. |
```
