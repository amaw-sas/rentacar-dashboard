---
name: extraction-services
created_by: orchestrator
created_at: 2026-06-12T00:00:00Z
---

# Holdout — Steps 2-3: extracción behavior-preserving a funciones de servicio

Contrato: extraer el núcleo de `app/api/reservations/availability/route.ts` y `app/api/reservations/route.ts` a `lib/api/availability-service.ts` / `lib/api/reservation-service.ts`, con errores vía `ServiceError`. **El contrato request/response de los dos endpoints públicos (consumidos por los dos funnels `rentacar-web` + `rentacar-reservas`) NO cambia.** Los 811 tests existentes deben seguir verdes; estos escenarios encodan los invariantes clave.

## SCEN-001: disponibilidad válida devuelve categorías ES (contrato intacto)
**Given**: `searchAvailability` con `pickupLocation`/`returnLocation` (codes) + `pickupDateTime`/`returnDateTime` válidos, y el proxy devuelve un array de categorías
**When**: se invoca el servicio (y el endpoint `POST /api/reservations/availability` con el mismo body + `x-api-key` válido)
**Then**: devuelve el array de categorías con `categoryDescription` traducido a ES (#74) y los campos de precio crudos (`totalAmount`, `estimatedTotalAmount`, `taxFeeAmount`, `IVAFeeAmount`, `coverageQuantity`, `coverageTotalAmount`, `returnFeeAmount`, `extraHoursQuantity`, `extraHoursTotalAmount`, `referenceToken`, `rateQualifier`) sin alterar; el endpoint devuelve respuesta idéntica a la actual
**Evidence**: retorno de `searchAvailability` + body de la respuesta HTTP; `tests/unit/api/availability-route.test.ts` verde

## SCEN-002: disponibilidad sin x-api-key → 401
**Given**: request a `POST /api/reservations/availability` sin header `x-api-key` (o incorrecto)
**When**: se procesa
**Then**: 401 `{ error: "No autorizado" }`; el servicio nunca se invoca
**Evidence**: status + body de la respuesta HTTP

## SCEN-003: disponibilidad con campo faltante → 400
**Given**: body sin uno de `pickupLocation`/`returnLocation`/`pickupDateTime`/`returnDateTime`
**When**: se procesa con `x-api-key` válido
**Then**: 400 con mensaje de campo requerido; no se llama al proxy
**Evidence**: status + body de la respuesta HTTP

## SCEN-004: error de negocio Localiza se propaga
**Given**: el proxy responde no-200 con `{error, message, shortText}` (fuera de horario / sin inventario)
**When**: `searchAvailability` procesa la respuesta
**Then**: propaga el `status` + payload del proxy sin reescribir (el endpoint devuelve ese mismo `{...}` y status)
**Evidence**: status + body de la respuesta HTTP

## SCEN-005: creación estándar válida → reserva creada (contrato intacto)
**Given**: `createReservation` con un input estándar válido (`selected_days < 30`, `reference_token`+`rate_qualifier` presentes), proxy OK
**When**: se invoca el servicio (y `POST /api/reservations` con el body equivalente + `x-api-key`)
**Then**: crea la reserva (insert en `reservations`), devuelve `{ reserveCode, reservationStatus }` con el status mapeado de Localiza (`reservado`/`pendiente`); el endpoint devuelve idéntico
**Evidence**: payload del insert capturado + body de la respuesta HTTP

## SCEN-006: estándar sin token/qualifier → ServiceError 400 con mensaje exacto
**Given**: input estándar (`selected_days < 30`) SIN `reference_token` o SIN `rate_qualifier`
**When**: `createReservation` se invoca
**Then**: lanza `ServiceError(400, { error: "reference_token y rate_qualifier son requeridos para reservas estándar" })`; el endpoint público devuelve ese `{error}` con status 400; no se llama al proxy
**Evidence**: error lanzado (status + payload) + body/status de la respuesta HTTP

## SCEN-007: passthrough estructurado del error del proxy (contrato toast de los funnels)
**Given**: el proxy de creación responde no-200 con JSON `{error, message, shortText}`
**When**: `createReservation` procesa la respuesta
**Then**: lanza `ServiceError(<status del proxy>, <payload completo {error,message,shortText}>)`; el endpoint público devuelve ese payload **byte-idéntico** con el mismo status (los funnels renderizan el toast desde `shortText`)
**Evidence**: error lanzado (status + payload completo) + body/status de la respuesta HTTP

## SCEN-008: customer existente NO se muta; snapshot desde la fila almacenada
**Given**: `findOrCreateCustomer` (lenient #25) resuelve a un customer EXISTENTE cuya fila almacenada difiere del body enviado
**When**: `createReservation` arma el insert
**Then**: `snapshotFromCustomer` se llama con el `customer_id` resuelto; los 5 campos `*_at_booking` del insert reflejan la FILA ALMACENADA, nunca el body; el customer existente no se reescribe
**Evidence**: payload del insert capturado (campos snapshot == fila almacenada, ≠ body)

## SCEN-009: mensual (selected_days >= 30) → sin proxy, status mensualidad
**Given**: input con `selected_days >= 30`
**When**: `createReservation` se invoca
**Then**: NO llama al proxy Localiza; status = `mensualidad`; `reserveCode` cae al `id` insertado
**Evidence**: ausencia de fetch al proxy + body de la respuesta (`reservationStatus: "mensualidad"`)

## SCEN-010: creación sin x-api-key → 401
**Given**: request a `POST /api/reservations` sin `x-api-key` válido
**When**: se procesa
**Then**: 401 `{ error: "No autorizado" }`; el servicio nunca se invoca
**Evidence**: status + body de la respuesta HTTP
