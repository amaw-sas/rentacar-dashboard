---
name: findorcreate-no-mutate
created_by: claude
created_at: 2026-06-02T00:00:00Z
issue: 25
related: [26]
---

# Issue #25 — `findOrCreateCustomer` no debe mutar contacto del cliente en colisión de CC

`POST /api/reservations` deduplica clientes por `identification_number`. El código previo (`lib/api/resolve-references.ts:50-76`) llamaba `update()` sobre la fila existente cuando el input difería en `first_name/last_name/email/phone/identification_type`. Como `reservations` solo guarda un FK a `customer_id` (sin snapshot histórico), esa mutación in-place reescribía el dueño aparente de **toda reserva pasada** atada a ese cliente.

Incidente 2026-05-12: una persona real (JOSE CHIACHIO, alquilame.co) reservó con `identification="123456"`, que colisionó con el customer de prueba `0c91b776` (`test90/test90`). El endpoint sobrescribió la fila de test con los datos de JOSE; luego un POST sentinela la revirtió. Cinco humanos distintos pasaron por ese customer en abril–mayo (visible en `notification_logs.recipient`).

Decisión de producto (confirmada por usuario, 2026-06-02): **Option A lenient**. En match, devolver el `id` existente sin escribir; en no-match, insertar. Sin rechazo y sin log — rechazar bloquearía reservas legítimas de clientes que actualizaron su teléfono/email (surgiría como 500 genérico al cliente). La precisión histórica del nuevo registro queda para el fix pareado #26 (snapshot at booking).

El lookup permanece sobre `identification_number` (no el par `(type, number)` que sugiere el issue): la UNIQUE `customers_identification_number_key` es solo sobre el número, así que matchear por el par enrutaría un request de mismo-número/distinto-tipo hacia un INSERT que viola la constraint y rompería la reserva con un 500.

Cobertura: unit tests aislados con mock de `createAdminClient`, validando que `update()` nunca se invoca en match y que el `id` existente se retorna intacto.

---

## SCEN-001: match con datos distintos NO muta la fila

**Given**: `public.customers` contiene una fila con `identification_number` = el del input pero `first_name/last_name/email/phone` distintos.
**When**: `findOrCreateCustomer(input)` se invoca con esos datos divergentes (input típico de rentacar-web).
**Then**: retorna el `id` existente. No se invoca `update()` ni `insert()`. La fila del customer queda byte-idéntica.

Razón observable: es el corazón del fix. Antes de #25 este path llamaba `update()` y reescribía el dueño de las reservas pasadas; ahora la fila es inmutable desde el endpoint público.

**Evidence**: test `returns existing id WITHOUT mutating when identification matches but contact data differs (issue #25)` en `tests/unit/api/resolve-references.test.ts`. Spies `update`/`updateEq`/`insert` verificados `not.toHaveBeenCalled()`.

## SCEN-002: match con datos idénticos retorna id sin escribir

**Given**: `public.customers` contiene una fila cuyos campos coinciden exactamente con el input.
**When**: `findOrCreateCustomer(input)` se invoca.
**Then**: retorna el `id` existente. No `update()`, no `insert()`.

Razón observable: comportamiento pre-existente preservado (el path "match idéntico" ya no escribía); garantiza que el fix no introduce escrituras espurias.

**Evidence**: test `returns existing customer id without updating when data matches (same identification)`.

## SCEN-003: sin match inserta nuevo customer

**Given**: `public.customers` no contiene fila con ese `identification_number`.
**When**: `findOrCreateCustomer(input)` se invoca.
**Then**: inserta una fila nueva con `status="active"` y los campos del input; retorna el nuevo `id`. El lookup consulta exactamente una vez sobre `identification_number` (sin fallback por email).

**Evidence**: test `creates a new customer when identification does not exist (no email fallback)`. Spy `selectEq` verificado contra `"identification_number"`, una sola invocación.

## SCEN-004: fallo de insert se propaga como error

**Given**: el INSERT de Supabase devuelve error (p.ej. violación de constraint por race).
**When**: `findOrCreateCustomer(input)` se invoca sin match previo.
**Then**: lanza `Error al crear cliente: <mensaje>`. El caller (`app/api/reservations/route.ts`) lo captura en su try/catch y responde 500.

**Evidence**: test `throws when insert fails`.

## SCEN-005: regresión del incidente 2026-05-12 (real-sobre-test)

**Given**: customer de prueba `0c91b776` (`test90/test90`, CC) en `public.customers`.
**When**: `findOrCreateCustomer` se invoca con datos de JOSE CHIACHIO e `identification_number="123456"` que matchea esa fila.
**Then**: retorna `0c91b776` intacto. No `update()`, no `insert()`. La fila de test conserva `test90/test90`.

Razón observable: reproduce el vector exacto del incidente. Con el código previo este caso sobrescribía la fila; el test falla sin el fix (verificado en red-green abajo).

**Evidence**: test `regression: real-on-test CC collision returns test customer id untouched (incident 2026-05-12)`.

---

## Out-of-scope (registrado para referencia)

- **Snapshot at booking (#26)**: paired fix. Con #25, una reserva nueva cuyo CC matchea un customer existente mostrará en el dashboard los datos del customer (los más antiguos), no los del request. Eso no es corrupción del histórico — es el nuevo registro mostrando data enlazada estable. La precisión por-reserva requiere snapshot de `first_name/last_name/email/phone` en `reservations` al momento del booking. Fuera de alcance de #25.
- **Validación de identificación en frontend** (`amaw-sas/rentacar-web#44`): defensa en profundidad, reduce colisiones por typo en origen. Repo distinto.
- **Mitigación de datos ya aplicada (2026-05-12)**: 36 customers sentinel/test archivados a `inactive` con CC defanged. No se revierte aquí.
