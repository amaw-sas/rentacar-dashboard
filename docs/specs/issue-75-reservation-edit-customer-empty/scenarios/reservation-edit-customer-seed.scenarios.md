---
name: reservation-edit-customer-seed
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-27T00:00:00Z
spec: docs/specs/issue-75-reservation-edit-customer-empty/
issue: 75
precedent: 19
---

# Scenarios — el formulario de edición carga el cliente vinculado aunque esté fuera de la ventana de 1000

Holdout contract para issue #75. Write-once tras el primer commit.

**Causa raíz:** tras el ETL #19, `customers` tiene 11.027 filas; `getCustomers()` (`lib/queries/customers.ts:3`) devuelve sólo 1000 (cap PostgREST por defecto). El form resuelve el cliente seleccionado con `customers.find(c => c.id === customerId)` para sembrar los inputs de contacto (`reservation-form.tsx:208-216`) y para la etiqueta del combobox (`combobox.tsx:54-57`). Para el 84% de las reservas (cliente fuera de la ventana) `find` → `undefined` → `EMPTY_CONTACT` → inputs vacíos.

**Fix:** `getReservation()` ya hace JOIN al cliente vinculado; se pasa como prop `selectedCustomer` al `ReservationForm`. El form siembra desde `selectedCustomer` cuando `customerId === selectedCustomer.id` y el cliente no está en `customers`, y lo mergea en las `options` del combobox para que la etiqueta resuelva el nombre. Alcance: SOLO edición de reserva. Combobox server-side (nueva reserva) + paginación `/customers` → #42.

Evidencia unit: vitest + @testing-library/react sobre `<ReservationForm>` (mismo patrón que `tests/unit/components/reservation-form.test.tsx`). Inputs por `getByLabelText("Nombre"|"Apellido"|"Identificación"|"Teléfono"|"Email")`; etiqueta del combobox por `getByLabelText("Cliente").textContent`.

---

## SCEN-001: editar una reserva cuyo cliente está FUERA de la ventana de 1000 muestra sus datos

**Given**: el form en modo edición (`id` presente) con `defaultValues.customer_id = "A"`, una prop `selectedCustomer` con los datos del cliente `A` (Juan Pérez, CC 1020304050, +57 300 1112233, juan@example.com), y un array `customers` que NO contiene a `A` (sólo otros clientes — simula la ventana truncada).
**When**: se renderiza el formulario.
**Then**: el combobox "Cliente" muestra "Juan Pérez" (no el placeholder), y los 6 inputs de contacto están pre-cargados: Nombre=Juan, Apellido=Pérez, tipo de id=CC, Identificación=1020304050, Teléfono=+57 300 1112233, Email=juan@example.com.
**Evidence**: (unit) `getByLabelText("Cliente").textContent` contiene "Juan Pérez"; `(getByLabelText("Nombre") as HTMLInputElement).value === "Juan"` y análogos para los demás campos. (runtime) /agent-browser sobre una reserva real de las 280 out-of-window: combobox + inputs poblados, cero errores de consola.

---

## SCEN-002: editar una reserva cuyo cliente SÍ está en la ventana sigue mostrando sus datos (sin regresión)

**Given**: el form en modo edición con `defaultValues.customer_id = "B"`, sin `selectedCustomer`, y `customers` que SÍ contiene a `B`.
**When**: se renderiza el formulario.
**Then**: el combobox muestra el nombre de `B` y los inputs se siembran desde `B`, exactamente como antes del fix.
**Evidence**: (unit) inputs pre-cargados con los valores de `B`; `getByLabelText("Cliente").textContent` contiene el nombre de `B`.

---

## SCEN-003: el fallback a selectedCustomer está acotado por id — no clobberea otro cliente seleccionado

**Given**: el form en edición con `selectedCustomer` = cliente `A` (fuera de `customers`) pero `defaultValues.customer_id = "B"`, donde `B` SÍ está en `customers` y `B != A`.
**When**: se renderiza el formulario.
**Then**: los inputs muestran los datos de `B` (no los de `A`); el fallback `?? selectedCustomer` no aplica porque `customerId !== selectedCustomer.id`.
**Evidence**: (unit) `(getByLabelText("Nombre") as HTMLInputElement).value` es el nombre de `B`, no el de `A`.

---

## SCEN-004: nueva reserva (sin selectedCustomer) arranca con la sección Cliente vacía (sin regresión)

**Given**: el form en modo creación (sin `id`, sin `customer_id`, sin `selectedCustomer`).
**When**: se renderiza el formulario.
**Then**: el combobox muestra el placeholder "Seleccionar cliente" y los inputs de contacto están vacíos y deshabilitados.
**Evidence**: (unit) inputs `value === ""` y `disabled`; `getByLabelText("Cliente").textContent` contiene "Seleccionar cliente".
