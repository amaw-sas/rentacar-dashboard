---
name: autosave-on-status-change
created_by: claude
created_at: 2026-06-16T00:00:00Z
issue: 153
supersedes_scenarios: [90]
related: [90, 137, 26, 36, 10]
---

# Issue #153 — Autoguardar la reserva al cambiar de estado

En la edición de reserva, pulsar un botón de estado con cambios sin guardar ya no
bloquea: **autoguarda** el formulario y/o el contacto del cliente (lo que esté
dirty) y, si todo persiste, **procede** con el cambio de estado. Si el guardado
falla, se aborta el estado y se muestra el error.

Inversión de control: `ReservationStatusActions` recibe un callback opcional
`onBeforeStatusChange?: () => Promise<boolean>` (reemplaza `hasUnsavedChanges`).
Antes de despachar, hace `await onBeforeStatusChange()`; `false` aborta.
`ReservationForm` implementa el callback: persiste lo dirty (form vía
`updateReservation` + `reset`, contacto vía `handleSaveCustomer`) y resuelve
`true`/`false`. La página de detalle omite el prop → estado idéntico al actual.

Oráculo: spies sobre `updateReservation`, `updateReservationStatus`,
`updateCustomerContact`. Presencia (`toHaveBeenCalled` / `not.toHaveBeenCalled`) y
**orden** (`mock.invocationCallOrder`: guardado antes que estado). `sonner` y
`window.confirm` mockeados. Gotcha #90: Radix Select no abre en jsdom → el camino
`setValue` se conduce por el checkbox "Conductor adicional".

**Supersedes #90:** SCEN-001..003, 005, 007, 008 de #90 (afirmaban bloqueo). Las
regresiones anti-falso-dirty de #90 se conservan reformuladas (SCEN-008, SCEN-009
de este spec).

---

## SCEN-001: editar un campo del formulario autoguarda y luego cambia el estado

**Given**: el formulario de edición (estado `nueva`), donde el operador cambia un
campo persistido por `register` (p. ej. "Días reservados" de `5` a `7`) y **no**
pulsa "Guardar cambios".
**When**: pulsa un botón de transición de estado válido (p. ej. "Reservado").
**Then**: `updateReservation` se llama **antes** que `updateReservationStatus`;
este último se llama con `(reservationId, "reservado")`. El dato nuevo se persiste
y el estado cambia en un solo clic.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx`. Spies con
`updateReservation` `toHaveBeenCalled()`, `updateReservationStatus`
`toHaveBeenCalledWith(id, "reservado")`, y
`updateReservation.mock.invocationCallOrder[0] < updateReservationStatus.mock.invocationCallOrder[0]`.
Red verificado: con el guard de #90 (bloqueo), `updateReservationStatus` no se
llama y el assert de orden falla.

## SCEN-002: editar el contacto del cliente autoguarda y luego cambia el estado

**Given**: el formulario con el form de reserva limpio, donde el operador edita un
campo de contacto del cliente (p. ej. el email) y **no** pulsa "Guardar cliente".
**When**: pulsa un botón de transición de estado.
**Then**: `updateCustomerContact` se llama **antes** que `updateReservationStatus`;
el contacto se persiste y el estado cambia.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx` que escribe
en el input de email, mockea `updateCustomerContact` resolviendo `{}`, y hace clic
en el botón de estado. Spies: `updateCustomerContact` `toHaveBeenCalled()`,
orden antes de `updateReservationStatus`. Red verificado: con el bloqueo de #90 el
estado no se dispara.

## SCEN-003: form y contacto dirty se persisten ambos antes del cambio de estado

**Given**: el formulario donde el operador edita un campo `register` del form **y**
un campo de contacto del cliente, sin guardar ninguno.
**When**: pulsa un botón de transición de estado.
**Then**: se llaman `updateReservation` **y** `updateCustomerContact`, ambos antes
de `updateReservationStatus`, que se llama una vez.

**Evidence**: test que edita "Días reservados" y el email, hace clic en estado, y
asserta las tres llamadas con `invocationCallOrder` de los dos guardados menores
que el del estado. Red verificado: si el orquestador solo guarda el form (olvida
el contacto), `updateCustomerContact` queda sin llamar.

## SCEN-004: sin cambios sin guardar, el cambio de estado dispara sin guardar de más

**Given**: el formulario de edición sin ediciones pendientes (form limpio y
contacto limpio).
**When**: pulsa un botón de transición de estado válido.
**Then**: `updateReservationStatus` se llama con `(reservationId, "reservado")` y
**ni** `updateReservation` **ni** `updateCustomerContact` se llaman (autoguardado
no-op).

**Evidence**: test con form limpio que hace clic en el botón de estado.
`updateReservationStatus` `toHaveBeenCalledWith(id, "reservado")`,
`updateReservation` y `updateCustomerContact` `not.toHaveBeenCalled()`. Red
verificado: un orquestador que guarde siempre (sin chequear dirty) llama a
`updateReservation` y falla el assert.

## SCEN-005: form inválido aborta el cambio de estado y no persiste nada

**Given**: el formulario donde el operador deja un campo requerido inválido (p. ej.
vacía "Día recogida") y hay cambios sin guardar.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservation` **no** persiste (zod falla en
`handleSubmit`→`onInvalid`), `updateReservationStatus` **no** se llama, y aparece
el error de validación en `root`.

**Evidence**: test que pone un campo requerido inválido y hace clic en estado.
`updateReservationStatus` `not.toHaveBeenCalled()`, el mensaje de error en el DOM.
Red verificado: si el orquestador despacha el estado sin esperar el resultado de
la validación, el spy de estado se llama y el assert falla.

## SCEN-006: error de servidor al guardar aborta el cambio de estado

**Given**: el formulario con un campo `register` editado (form válido), donde
`updateReservation` está mockeado para resolver `{ error: "boom" }`.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservationStatus` **no** se llama y el error "boom" se muestra en
`root`.

**Evidence**: test que edita un campo, mockea `updateReservation` con `{error}`, y
hace clic en estado. `updateReservation` `toHaveBeenCalled()`,
`updateReservationStatus` `not.toHaveBeenCalled()`, "boom" en el DOM. Red
verificado: si el callback ignora el `{error}` y resuelve `true`, el estado se
dispara y el assert falla.

## SCEN-007: target peligroso pide confirmación ANTES de guardar; cancelar no guarda ni cambia

**Given**: el formulario con un campo editado sin guardar y `currentStatus` cuya
transición incluye un target peligroso (p. ej. "Cancelado"); el operador
**cancela** el `window.confirm`.
**When**: pulsa el botón "Cancelado".
**Then**: ni `updateReservation`, ni `updateCustomerContact`, ni
`updateReservationStatus` se llaman. El `window.confirm` se mostró una vez.

**Evidence**: test con `window.confirm` mockeado devolviendo `false`, un campo del
form editado, clic en el botón peligroso. Las tres acciones
`not.toHaveBeenCalled()`, `window.confirm` `toHaveBeenCalled()`. Red verificado:
si el guardado corre antes del confirm, `updateReservation` se llama y el assert
falla (confirm-primero es el invariante).

## SCEN-008: el montaje del formulario no autoguarda (regresión anti falso-dirty)

**Given**: el formulario recién montado desde una reserva existente con defaults
numéricos (`selected_days`, `coverage_days`, `extra_hours` son *number*), sin
ninguna edición del operador.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservation` **no** se llama (no hay nada dirty) y
`updateReservationStatus` **sí** se llama. El montaje (coerción string/number de
los inputs numéricos) no debe disparar un autoguardado espurio.

**Evidence**: test que monta con `defaultValues` numéricos realistas y, sin tocar
ningún campo, hace clic en estado. `updateReservation` `not.toHaveBeenCalled()`,
`updateReservationStatus` `toHaveBeenCalled()`. Red verificado: si `dirtyFields`
reportara falso-positivo al montar, el orquestador guardaría de más y el primer
assert fallaría.

## SCEN-009: editar y revertir un numérico al valor exacto NO autoguarda

**Given**: el formulario donde el operador escribe en un numérico `register` ("Días
reservados", default `5`) y luego lo **revierte al valor original** (`5`→`7`→`5`),
sin cambio neto.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservation` **no** se llama (el dirty del campo se limpió al
revertir) y `updateReservationStatus` **sí** se llama.

**Evidence**: test que monta con `selected_days: 5`, cambia a `7`, vuelve a `5`, y
hace clic en estado. `updateReservation` `not.toHaveBeenCalled()`,
`updateReservationStatus` `toHaveBeenCalled()`. Red verificado: sin el
`setValueAs`/coerción numérica, el campo queda en `dirtyFields` para siempre y el
orquestador autoguarda un no-cambio (fricción).

## SCEN-010: editar un campo del camino `setValue` autoguarda y luego cambia el estado

**Given**: el formulario donde el operador edita un campo que se persiste con
`setValue(..., { shouldDirty: true })` — la clase del **lugar de recogida**
(evidencia del #90), franquicia, categoría y los checkboxes de adicionales — sin
guardar.
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservation` se llama antes que `updateReservationStatus`; el
cambio del Select/checkbox cuenta como dirty y se persiste.

**Evidence**: test que activa el checkbox "Conductor adicional" (mismo wiring
`setValue` que los Selects de lugar/franquicia/categoría, conducible en jsdom) y
hace clic en estado. `updateReservation` antes de `updateReservationStatus` por
`invocationCallOrder`. Red verificado: sin `{ shouldDirty: true }` el cambio es
invisible a `dirtyFields`, no se autoguarda, y el dato del Select se pierde.

## SCEN-011: la página de detalle no autoguarda (prop ausente → cambio directo)

**Given**: `ReservationStatusActions` renderizado **sin** el prop
`onBeforeStatusChange` (uso de la página de detalle, solo lectura), con
`currentStatus="nueva"`.
**When**: el operador pulsa un botón de transición de estado válido.
**Then**: `updateReservationStatus` se llama con `(reservationId, target)`
directamente. La ausencia del callback preserva el comportamiento actual.

**Evidence**: test en `tests/unit/components/reservation-status-actions.test.tsx`
que renderiza sin `onBeforeStatusChange` y hace clic en un botón.
`updateReservationStatus` `toHaveBeenCalledWith(reservationId, target)`. Red
verificado: si el componente exige el callback (lo llama sin verificar presencia),
crashea o no despacha y el assert falla.

## SCEN-012: tras autoguardar, un segundo cambio de estado no vuelve a guardar

**Given**: el formulario con un campo editado; el operador pulsa un estado, el
autoguardado persiste y el form se resetea (`reset(data)` limpia `dirtyFields`).
**When**: vuelve a pulsar otro botón de transición de estado válido (sin tocar
ningún campo entre medias).
**Then**: en el segundo clic, `updateReservation` **no** se vuelve a llamar (form
ya limpio) y `updateReservationStatus` sí.

**Evidence**: test que edita un campo, pulsa estado (1er save), luego pulsa otro
estado y asserta que `updateReservation` quedó en **1** llamada y
`updateReservationStatus` en **2**. Red verificado: sin `reset(data)` tras el
guardado, `dirtyFields` sigue sucio y el segundo clic re-guarda (2 llamadas a
`updateReservation`) → el assert de "1 llamada" falla.

## SCEN-013: tras un guardado fallido el formulario queda editable y se puede reintentar

**Given**: el formulario con un campo `register` editado, donde `updateReservation`
está mockeado para fallar el primer intento (`{ error: "boom" }`) y resolver `{}`
el segundo.
**When**: pulsa un botón de estado (1er intento falla, estado no cambia), corrige
nada / reintenta pulsando estado de nuevo.
**Then**: en el 1er intento `updateReservationStatus` **no** se llama y el error es
visible; los inputs del formulario **no** quedan deshabilitados (banderas de carga
limpiadas en `finally`). En el 2º intento `updateReservation` persiste y
`updateReservationStatus` **sí** se llama.

**Evidence**: test que asserta, tras el 1er clic, que el campo editado sigue
habilitado (no `disabled`) y `updateReservationStatus` `not.toHaveBeenCalled()`;
tras el 2º clic, `updateReservationStatus` `toHaveBeenCalled()`. Red verificado: si
una bandera de carga no se limpia en el fallo, el input queda deshabilitado y el
reintento es imposible → el assert de "habilitado" falla.

## SCEN-014: durante el autoguardado en vuelo los botones de estado quedan deshabilitados (anti doble-dispatch)

Hallazgo del gate de calidad (edge-case): el `await onBeforeStatusChange()` corre
ANTES de `startTransition`, así que `isPending` es `false` durante el guardado. Con
guardados lentos documentados (20s–2min, #100), un segundo clic dispararía un
segundo guardado y un segundo cambio de estado → notificaciones duplicadas.

**Given**: `ReservationStatusActions` con un `onBeforeStatusChange` que aún no
resuelve (guardado en vuelo).
**When**: el operador pulsa un botón de estado y, antes de que el callback
resuelva, intenta pulsar otra vez (mismo u otro target).
**Then**: tras el primer clic los botones de estado quedan **deshabilitados**
mientras el autoguardado está en vuelo; el segundo clic no dispara un segundo
`onBeforeStatusChange` ni un segundo `updateReservationStatus`. Al resolver, el
flujo despacha el estado **una sola vez**.

**Evidence**: test en `tests/unit/components/reservation-status-actions.test.tsx`
con `onBeforeStatusChange` mockeado devolviendo una promesa controlada (deferred):
tras el 1er clic los botones están `disabled` y un 2º clic no incrementa las
llamadas; al resolver `true`, `updateReservationStatus` se llama exactamente 1×.
Red verificado: sin la bandera `autosaving` (disable solo por `isPending`), los
botones quedan habilitados durante el await y el 2º clic dispara una 2ª llamada.

## SCEN-015: contacto inválido aborta antes de persistir el formulario (sin medio-commit)

Hallazgo del gate de calidad (edge-case): si el form se persiste y luego el
contacto falla por validación, la reserva queda escrita, el estado no cambia y el
dirty del form se limpia → el operador cree que no pasó nada. Pre-validar el
contacto antes de escribir el form evita el medio-commit.

**Given**: el formulario con un campo `register` del form editado (dirty) **y** el
contacto del cliente editado a un valor **inválido** (p. ej. email malformado que
`customerContactSchema` rechaza).
**When**: pulsa un botón de transición de estado.
**Then**: `updateReservation` **no** se llama (no se persiste el form),
`updateCustomerContact` **no** se llama, `updateReservationStatus` **no** se llama,
y se muestra el error del contacto. El form no queda medio-guardado.

**Evidence**: test en `tests/unit/components/reservation-form.test.tsx` que edita
"Días reservados" y pone un email inválido en el contacto, luego pulsa estado.
`updateReservation`, `updateCustomerContact` y `updateReservationStatus` todos
`not.toHaveBeenCalled()`; el `customerError` visible en el DOM. Red verificado: si
el orquestador persiste el form antes de validar el contacto, `updateReservation`
se llama 1× y el assert de "no persiste el form" falla.
