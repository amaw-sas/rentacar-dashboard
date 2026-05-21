---
name: referral-readonly-edit
created_by: claude
created_at: 2026-05-21T00:00:00Z
issue: 48
parent_audit: 13
related: [10, 46, 47, 52]
---

# Issue #48 — Atribución de referido fija desde creación (anti-fraude temporal)

Vector de fraude: un operador con acceso a edición puede reasignarse a sí mismo el referido de una reserva que no gestionó y cobrar comisión. La atribución debe quedar fija desde la creación — `rentacar-web` la setea vía query param o el form interno de nueva reserva. La pantalla de edición debe mostrar el referido actual pero no permitir cambiarlo.

Cambio mínimo en dos capas, mismo patrón que #10 (strip de `status` en update):

- **Server (defense-in-depth)**: `lib/actions/reservations.ts` → `updateReservation` strippea `referral_id` y `referral_raw` del payload antes del `.update()` de Supabase. UI-only es bypassable con FormData crafted.
- **UI (informativo)**: `components/forms/reservation-form.tsx` setea `disabled={isEditing}` en el `Select` de `referral_id` y en el `Input` de `referral_raw`. Valor visible, no editable.

Fuera de scope: estrategia definitiva anti-fraude (pendiente con directivas), cualquier cambio en rentacar-web, cambios en la creación de reservas.

---

## SCEN-001: edición muestra el Select de referido deshabilitado con valor visible

**Given**: una reserva existente con `referral_id` apuntando a Daniela (`code='REF1'`).
**When**: se renderiza el `ReservationForm` con `id` definido (edición) y `defaultValues.referral_id` apuntando a esa referral.
**Then**: el `SelectTrigger` con label "Referido" tiene atributo `disabled` y su texto contiene "Daniela". El operador ve quién es el referido y no puede cambiarlo.

**Evidence**: test `disables the referral_id Select trigger when editing` en `tests/unit/components/reservation-form.test.tsx`.

## SCEN-002: edición muestra el Input de `referral_raw` deshabilitado con valor visible

**Given**: una reserva existente con `referral_raw='feria-2026'` (atribución libre seteada en creación).
**When**: se renderiza el `ReservationForm` con `id` definido y `defaultValues.referral_raw='feria-2026'`.
**Then**: el `Input` con label "Referido (texto libre)" tiene atributo `disabled` y su `value` es `"feria-2026"`.

**Evidence**: test `disables the referral_raw input when editing`.

## SCEN-003: creación deja ambos controles habilitados

**Given**: pantalla de nueva reserva (sin `id`).
**When**: se renderiza el `ReservationForm` sin `id`.
**Then**: el `SelectTrigger` y el `Input` de referido NO tienen `disabled`. La atribución legítima en creación sigue funcionando.

**Evidence**: test `keeps referral controls editable when creating a new reservation`.

## SCEN-004: `updateReservation` strippea `referral_id` y `referral_raw` del payload

**Given**: una reserva existente y un operador malicioso que craftea un `FormData` válido incluyendo `referral_id` apuntando a sí mismo y `referral_raw='operador-fraudulento'`.
**When**: se invoca `updateReservation('res-1', formData)` con Supabase mockeado.
**Then**: la llamada a `from('reservations').update(payload)` recibe un payload donde `'referral_id' in payload === false`, `'referral_raw' in payload === false`, y `'status' in payload === false` (precedente #10).

Razón observable: aunque el operador bypassee el `disabled` del UI (DevTools, curl, etc.), las columnas no se actualizan. El UI es informativo; la barrera real es server-side.

**Evidence**: test `strips referral_id and referral_raw so an operator cannot reassign attribution (issue #48)` en `tests/unit/actions/reservations.test.ts`.

## SCEN-005: `createReservation` preserva `referral_id` y `referral_raw`

**Given**: el form interno de nueva reserva o el POST de rentacar-web.
**When**: se invoca `createReservation(formData)` con `referral_id` y `referral_raw` definidos.
**Then**: la llamada a `from('reservations').insert(payload)` recibe `payload.referral_id === REFERRAL_ID` y `payload.referral_raw === 'rentacar-web-attribution'`.

Razón observable: la atribución en creación es legítima (query param de rentacar-web o selección del operador en form interno). El fix de #48 NO debe romper este path.

**Evidence**: test `preserves referral_id and referral_raw on create (legitimate attribution path)`.

---

## Out-of-scope (registrado para referencia)

- **Estrategia definitiva anti-fraude**: pendiente con directivas. Posibles direcciones: auditoría de cambios en `referral_id` con `notification_logs`-like snapshot; permiso explícito por rol; ventana temporal post-creación; UI separada para "reasignar atribución" que escribe a una tabla distinta. Issue separado cuando se priorice.
- **`referral_raw` derivado vs editable**: hoy `referral_raw` es texto libre que `rentacar-web` setea desde `body.user`. Mientras esa shape exista, el campo es atribución cruda con valor de audit-trail — congelarlo en edición preserva la verdad histórica (alineado con feedback `feedback_findorcreate_no_mutate.md`).
