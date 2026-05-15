---
name: customer-inline-edit
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-15T00:00:00Z
issue_origin: "#36 — editar datos de contacto del cliente inline desde la edición de reserva (opción A)"
---

# Scenarios — Edición inline del cliente desde la reserva

Holdout contract for Issue #36. Spec: `docs/specs/2026-05-15-customer-inline-edit-reservation-design.md`.
Plan: `docs/specs/2026-05-15-customer-inline-edit-reservation-plan.md`.

Hoy los 5 campos del cliente en `components/forms/reservation-form.tsx` son
`readOnly`. El operador no puede corregir un dato mal cargado sin salir del
flujo. Estas escenas definen el comportamiento observable de la opción A:
edición inline + botón "Guardar cliente" independiente del submit de la reserva,
sin pérdida de `notes`/`status`.

---

## SCEN-001: corregir el email persiste y se refleja sin recarga manual

**Given**: el operador edita una reserva existente con un cliente seleccionado
cuyo email es `viejo@mail.com`.
**When**: cambia el campo Email a `nuevo@mail.com` y pulsa "Guardar cliente"
(botón distinto del submit de la reserva).
**Then**: el registro del cliente queda con `email = "nuevo@mail.com"` en la
tabla `customers`; la card Cliente muestra el nuevo email; el combobox de
cliente refleja el cambio tras resolver el refresh (sin que el operador recargue
la página manualmente); y los demás campos del formulario de reserva (vehículo,
precios, fechas, etc.) conservan exactamente los valores que tenían antes del
guardado.
**Evidence**: fila `customers` (columna `email`) leída tras el guardado;
DOM de la card Cliente y de la opción seleccionada del combobox; valores de los
inputs de la reserva (RHF) inalterados antes/después del click — verificado vía
`/agent-browser` en el dashboard real.

---

## SCEN-002: guardar contacto NO altera notes ni status

**Given**: un cliente con `notes = "cliente VIP"` y `status = "inactive"` está
seleccionado en una reserva en edición.
**When**: el operador cambia solo el Teléfono y pulsa "Guardar cliente".
**Then**: en la tabla `customers` la fila queda con el teléfono nuevo pero
`notes` sigue siendo `"cliente VIP"` y `status` sigue siendo `"inactive"` —
sin pérdida ni reseteo a los defaults del schema completo.
**Evidence**: fila `customers` leída tras el guardado mostrando `phone`
actualizado y `notes`/`status` sin cambios; a nivel unitario, el objeto pasado
a `supabase.from("customers").update(...)` contiene exactamente las 6 claves de
contacto y NO contiene `notes` ni `status` (assertion sobre el spy del mock en
`tests/unit/actions/customers.test.ts`).

---

## SCEN-003: email inválido bloquea el guardado sin tocar la BD ni la reserva

**Given**: el operador tiene un cliente seleccionado y escribe `noesunemail`
en el campo Email del bloque cliente.
**When**: pulsa "Guardar cliente".
**Then**: aparece un mensaje de error inline en la card Cliente indicando que
el email es inválido; no se realiza ninguna escritura en `customers`; el
formulario de reserva permanece intacto y enviable.
**Evidence**: mensaje de error visible en el DOM de la card Cliente; ausencia
de llamada a Supabase `update` (spy no invocado en el test unitario de
`updateCustomerContact` para payload con email inválido → retorna `{ error }`
sin tocar el cliente Supabase); estado del form de reserva sin cambios.

---

## SCEN-004: identificación duplicada muestra mensaje amigable inline

**Given**: el operador edita la identificación del cliente seleccionado a un
`identification_number` que ya pertenece a OTRO cliente.
**When**: pulsa "Guardar cliente".
**Then**: ve el mensaje exacto "Ya existe un cliente con ese número de
identificación" inline en la card Cliente; el formulario de reserva no se ve
afectado y sigue siendo enviable.
**Evidence**: test unitario de `updateCustomerContact`: dado un error Supabase
con `code === "23505"` cuyo `message` incluye `"identification_number"`, la
función retorna `{ error: "Ya existe un cliente con ese número de
identificación" }`; runtime: el string aparece en el DOM de la card Cliente.

---

## SCEN-005: sin cliente seleccionado, el botón está deshabilitado

**Given**: una reserva (nueva o en edición) sin cliente seleccionado en el
combobox.
**When**: el operador observa la card Cliente.
**Then**: los inputs de contacto están deshabilitados y el botón "Guardar
cliente" está deshabilitado (no se puede invocar la acción sin un id de
cliente).
**Evidence**: atributo `disabled` presente en el botón "Guardar cliente" y en
los inputs de contacto cuando `customer_id` está vacío — verificado en el DOM.

---

## SCEN-006: cambiar de cliente re-siembra los campos y descarta la edición

**Given**: el operador editó el Teléfono del cliente A en el bloque cliente
pero NO pulsó "Guardar cliente" (draft sucio).
**When**: selecciona el cliente B en el combobox.
**Then**: los campos de contacto se re-siembran con los datos persistidos del
cliente B (nombre, apellido, tipo ID, identificación, teléfono, email de B);
la edición no guardada del cliente A se descarta; el botón "Guardar cliente"
vuelve a estado no-dirty (deshabilitado) hasta que el operador edite a B.
**Evidence**: valores de los inputs de contacto en el DOM coinciden con los
datos de B (no con el teléfono editado de A) tras cambiar la selección del
combobox.

---

## SCEN-007: sin cambios respecto a lo persistido, el botón está deshabilitado

**Given**: un cliente seleccionado cuyos campos de contacto en el bloque
coinciden exactamente con lo persistido (draft == snapshot, sin ediciones).
**When**: el operador observa el botón "Guardar cliente".
**Then**: el botón está deshabilitado; en cuanto el operador modifica cualquier
campo de contacto, el botón se habilita; si revierte el cambio al valor original
exacto, el botón vuelve a deshabilitarse.
**Evidence**: atributo `disabled` del botón "Guardar cliente" alternando según
el estado dirty (draft vs snapshot) — verificado en el DOM al editar y revertir.

---

## SCEN-008: el botón "Guardar cliente" no dispara el submit de la reserva

**Given**: el operador tiene cambios pendientes en el bloque cliente dentro de
una reserva en edición.
**When**: pulsa "Guardar cliente".
**Then**: se ejecuta únicamente la acción de actualización del cliente; la
reserva NO se envía (no hay redirect a `/reservations`, no se invoca
`updateReservation`); el operador permanece en el formulario de reserva.
**Evidence**: el botón tiene `type="button"`; tras el click no hay navegación
fuera del formulario de reserva ni llamada a la acción de reserva — verificado
vía `/agent-browser` (URL sin cambio, ausencia de request de `updateReservation`).
