---
name: status-unsaved-guard
created_by: claude
created_at: 2026-06-12T00:00:00Z
issue: 90
related: [87, 26, 36]
---

# Issue #90 — Bloquear cambio de estado con cambios sin guardar del formulario

En la edición de reserva, el botón de estado (`ReservationStatusActions` →
`updateReservationStatus`) dispara la notificación leyendo la reserva en vivo de
la BD, ignorando lo que el operador escribió en el formulario (lugar/fechas/
precios) y en el contacto del cliente y aún **no guardó**. Resultado: notificación
con datos viejos, sin señal de error.

Fix: el componente de estado recibe un prop opcional `hasUnsavedChanges?: boolean`
(default `false`). Si es `true`, el clic en un botón de estado **no dispara**
nada (ni `window.confirm`, ni la acción): muestra un aviso inline + toast pidiendo
guardar primero. El formulario calcula `hasUnsavedChanges = isDirty || isCustomerDirty`
(react-hook-form + el draft de contacto ya existente) y lo pasa al componente. La
página de detalle (solo lectura) omite el prop → comportamiento intacto.

Cobertura: unit tests con `@testing-library/react` en
`tests/unit/components/reservation-status-actions.test.tsx` (render directo del
componente, Step 1) y en `tests/unit/components/reservation-form.test.tsx`
(cableado vía formulario, Step 2). El mock de `updateReservationStatus` es el
oráculo "disparó / no disparó". `sonner` mockeado.

**Alcance de cada step:** Step 1 satisface SCEN-006 y SCEN-007 (nivel componente).
Step 2 satisface SCEN-001..005 (cableado del formulario).

---

## SCEN-001: editar un campo del formulario bloquea el cambio de estado

**Given**: el formulario de edición de una reserva (estado `nueva`), donde el
operador cambia el lugar de recogida a otra sucursal y **no** pulsa "Guardar
cambios".
**When**: pulsa un botón de transición de estado (p. ej. "Reservado").
**Then**: `updateReservationStatus` **no** se llama y aparece el aviso "Tienes
cambios sin guardar…". La notificación no se dispara.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx`. Spy
`updateReservationStatus` con `not.toHaveBeenCalled()`; el texto del aviso está en
el DOM. Red verificado: sin el guard (o sin pasar el prop), el spy se llama 1×.

## SCEN-002: editar el contacto del cliente bloquea el cambio de estado

**Given**: el formulario de edición con el form de reserva limpio, donde el
operador edita un campo de contacto del cliente (p. ej. el email) y **no** pulsa
"Guardar cliente".
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservationStatus` **no** se llama y aparece el aviso.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx` que escribe
en el input de email (activa `isCustomerDirty`) y hace clic en el botón de estado;
`updateReservationStatus` con `not.toHaveBeenCalled()`. Red verificado: si el guard
solo mira `isDirty` del form (no `isCustomerDirty`), el spy se llama.

## SCEN-003: sin cambios sin guardar, el cambio de estado dispara

**Given**: el formulario de edición sin ediciones pendientes (form limpio y
contacto limpio).
**When**: pulsa un botón de transición de estado válido (p. ej. "Reservado").
**Then**: `updateReservationStatus` **sí** se llama exactamente con
`(reservationId, "reservado")` y se ejecuta el flujo actual.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx`. Spy
`updateReservationStatus` con `toHaveBeenCalledWith(id, "reservado")`. Red
verificado: un guard que bloquee siempre (ignorando el flag) deja el spy sin
llamar y falla este assert.

## SCEN-004: el formulario recién cargado no bloquea (regresión anti falso-dirty)

**Given**: el formulario de edición recién montado desde una reserva existente con
defaults numéricos (`selected_days`, `coverage_days`, `extra_hours` son *number*),
sin ninguna edición del operador.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservationStatus` **sí** se llama. El montaje por sí solo (con
inputs numéricos que `register` emite como *string* vs defaults *number*) no debe
marcar el form como "con cambios sin guardar".

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx` que monta el
form con `defaultValues` numéricos realistas y, sin interactuar con ningún campo,
hace clic en el botón de estado; `updateReservationStatus` con
`toHaveBeenCalled()`. Red verificado: usar `formState.isDirty` ingenuamente,
si RHF reporta dirty al montar por la coerción string/number, bloquea y este
assert falla → la mitigación (`dirtyFields`) lo vuelve verde.

## SCEN-005: guardar el contacto del cliente desbloquea el cambio de estado

**Given**: el formulario con el form de reserva limpio salvo el contacto del
cliente editado; el operador pulsa "Guardar cliente" y la acción tiene éxito
(resetea `isCustomerDirty` sin recargar la página).
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservationStatus` **sí** se llama (el guardado del cliente
desbloqueó el estado en el sitio, sin recargar).

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx` que edita el
email, mockea `updateCustomerContact` resolviendo `{}`, pulsa "Guardar cliente",
espera el reseteo del dirty, y luego hace clic en el botón de estado;
`updateReservationStatus` con `toHaveBeenCalled()`. Red verificado: si el guard no
reacciona al reseteo de `isCustomerDirty`, sigue bloqueando y el assert falla.

## SCEN-006: la página de detalle nunca bloquea (prop ausente → default false)

**Given**: `ReservationStatusActions` renderizado **sin** el prop
`hasUnsavedChanges` (el uso de la página de detalle, solo lectura), con
`currentStatus="nueva"`.
**When**: el operador pulsa un botón de transición de estado válido.
**Then**: `updateReservationStatus` **sí** se llama con `(reservationId, target)`.
El default `false` preserva el comportamiento actual.

**Evidence**: test en `tests/unit/components/reservation-status-actions.test.tsx`
que renderiza el componente sin `hasUnsavedChanges` y hace clic en un botón;
`updateReservationStatus` con `toHaveBeenCalledWith(reservationId, target)`. Red
verificado: si el guard bloquea cuando el prop es `undefined`, el spy no se llama
y el assert falla.

## SCEN-007: con cambios sin guardar (prop true) el componente bloquea y avisa

**Given**: `ReservationStatusActions` renderizado con `hasUnsavedChanges={true}` y
`currentStatus="nueva"`.
**When**: el operador pulsa un botón de transición de estado (incluido uno
peligroso como "Cancelado").
**Then**: `updateReservationStatus` **no** se llama, **no** aparece el
`window.confirm` de targets peligrosos, y se muestra el aviso inline + se invoca
`toast.error`.

**Evidence**: test en `tests/unit/components/reservation-status-actions.test.tsx`
con `hasUnsavedChanges` en `true`: spy `updateReservationStatus` con
`not.toHaveBeenCalled()`, `window.confirm` espiado con `not.toHaveBeenCalled()`,
el texto del aviso en el DOM y `toast.error` con `toHaveBeenCalled()`. Red
verificado: sin el short-circuit el spy se llama (y para el target peligroso
aparece el confirm).

## SCEN-008: editar un campo persistido por `setValue` bloquea el cambio de estado

**Given**: el formulario de edición donde el operador edita un campo que se
persiste con `setValue` (no con `register`) — la clase que incluye el **lugar de
recogida** (el caso exacto de la evidencia del issue, Ibagué→Neiva), franquicia,
categoría y los checkboxes de adicionales — y **no** pulsa "Guardar cambios".
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservationStatus` **no** se llama y aparece el aviso. Los
campos editados por `setValue` deben contar como cambios sin guardar igual que
los `register`.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx`. Como
Radix Select no renderiza opciones en jsdom, el test conduce el camino `setValue`
equivalente vía el checkbox "Conductor adicional" (`setValue("extra_driver", …)`),
que comparte el wiring `setValue(..., { shouldDirty: true })` con los Selects de
lugar/franquicia/categoría; tras el clic en el botón de estado,
`updateReservationStatus` con `not.toHaveBeenCalled()` y el aviso en el DOM. Red
verificado: sin `{ shouldDirty: true }` en esos `setValue`, el cambio es invisible
a `dirtyFields`, el guard no bloquea y el spy se llama (el footgun original del #90).
