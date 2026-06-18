---
name: db-idempotency
created_by: claude
created_at: 2026-06-17T00:00:00Z
issue: 138
related: [99]
---

# Issue #138 — Idempotencia DB-backed en el dashboard

Holdout de comportamiento observable para la guarda DB-backed que evita filas y
notificaciones duplicadas en un resubmit/multi-instancia, tras el dedupe del proxy de #99.

Diseño: `docs/specs/2026-06-17-issue-138-db-idempotency-design.md`.
Plan: `docs/specs/2026-06-17-issue-138-db-idempotency-plan.md`.

Frontera de verificación:
- **SCEN-A / SCEN-D / SCEN-E** → unit (vitest) con mock del cliente Supabase: lógica de rama del `23505`.
- **SCEN-B / SCEN-C / SCEN-F** → SQL sobre una branch de Supabase de testing: comportamiento del índice parcial (jsdom no construye índices).

---

## SCEN-A: replay del mismo reservation_code no duplica fila ni notifica

**Given**: una reserva estándar con `reservation_code = K` (no vacío) ya insertada en
`reservations` (`created_at >= '2026-01-01'`), y el índice único parcial
`reservations_reservation_code_unique` activo.
**When**: `createReservation` intenta insertar una segunda fila con el mismo `K`
(resubmit o 2ª instancia de Fluid Compute) y el `INSERT` devuelve
`{ error: { code: '23505', message: '...reservations_reservation_code_unique...' } }`.
**Then**: `createReservation` devuelve `{ reserveCode: K, reservationStatus: status }`
idéntico al éxito, y **no** invoca `sendReservationNotifications`, `sendStatusWhatsApp`
ni `syncReservationToGhl`.

**Evidence**: valor de retorno de `createReservation` + spies en las 3 funciones de
notificación con 0 llamadas (`tests/unit/api/reservation-service.test.ts`).

## SCEN-B: dos reservas con codes distintos no se funden

**Given**: el índice `reservations_reservation_code_unique` activo.
**When**: se insertan dos filas con `reservation_code` **distintos** y
`created_at >= '2026-01-01'` (p. ej. dos reservas reales en <60s).
**Then**: ambas insertan; quedan **2 filas**.

**Evidence**: `count(*)` = 2 tras los dos `INSERT` en la branch de Supabase de testing.

## SCEN-C: reservation_code vacío nunca deduplica

**Given**: el índice `reservations_reservation_code_unique` activo (predicado excluye `''`).
**When**: se insertan dos filas con `reservation_code = ''` y `created_at >= '2026-01-01'`.
**Then**: ambas insertan; quedan **2 filas** (el `''` no entra al índice).

**Evidence**: `count(*)` = 2 tras los dos `INSERT`; ningún `23505` en la branch de testing.

## SCEN-D: cliente nuevo concurrente recupera el id sin 500 ni segunda escritura

**Given**: dos requests de cliente **nuevo** con el mismo `identification_number` en
paralelo; `customers_identification_number_key` es la única UNIQUE de `customers`.
**When**: el primero gana el `INSERT` y el segundo choca con
`{ code: '23505', ...customers_identification_number_key... }`.
**Then**: `findOrCreateCustomer` del segundo re-SELECT por `identification_number` y
devuelve el `id` existente **sin** relanzar y **sin** escribir un segundo customer.

**Evidence**: valor de retorno de `findOrCreateCustomer` = id ganador; el spy de `insert`
no se vuelve a llamar tras el conflicto (`tests/unit/api/resolve-references.test.ts`).

## SCEN-E: un 23505 de otra constraint NO se trata como replay

**Given**: `createReservation` en el camino de insert.
**When**: el `INSERT` falla con `{ code: '23505', message: '...customers_pkey...' }`
(u otra constraint distinta de `reservations_reservation_code_unique`).
**Then**: `createReservation` lanza `ServiceError(500)` — no devuelve un replay ni se
salta las notificaciones de un éxito inexistente.

**Evidence**: `createReservation` rechaza con `ServiceError` status 500
(`tests/unit/api/reservation-service.test.ts`).

## SCEN-F: el índice construye sobre prod sin tocar el histórico legacy

**Given**: la tabla `reservations` con 49 pares de `reservation_code` duplicados legacy
(todos `created_at <= 2025-12-06`).
**When**: corre la migración `062` (`CREATE UNIQUE INDEX ... WHERE reservation_code IS
NOT NULL AND reservation_code <> '' AND created_at >= '2026-01-01'`).
**Then**: el índice se crea con éxito y **0 filas** se borran o modifican.

**Evidence**: la migración aplica sin error en la branch de testing sembrada con los 49
pares; `count(*)` de `reservations` idéntico pre/post.
