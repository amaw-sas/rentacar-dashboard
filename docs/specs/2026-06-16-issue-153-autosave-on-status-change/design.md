---
name: autosave-on-status-change
created_by: claude
created_at: 2026-06-16T00:00:00Z
issue: 153
supersedes_scenarios: [90]
related: [90, 137, 26, 36, 10]
---

# Issue #153 — Autoguardar la reserva al cambiar de estado (follow-up #90)

## Problema

La #90 bloquea el botón de estado cuando el formulario de edición tiene cambios
sin guardar. La corrección era necesaria —el cambio de estado dispara la
notificación leyendo la BD en vivo, así que con datos sin guardar saldría con
valores viejos— pero el remedio (bloquear y pedir "guarda primero") dejó un flujo
engorroso para el caso más común: editar un dato y aprobar la reserva.

Hoy el operador hace cuatro pasos y dos navegaciones:

1. Cambia un dato (p. ej. lugar de recogida).
2. Pulsa "Guardar cambios" → el form lo devuelve **al listado**.
3. Vuelve a entrar a la reserva.
4. Cambia el estado.

## Solución

Invertir el bloqueo en **guardar-y-continuar**. Al pulsar un botón de estado con
cambios sin guardar:

1. Se autoguarda lo que esté dirty (formulario RHF y/o contacto del cliente), en
   sitio, sin navegar.
2. Si todo persiste, se procede con el cambio de estado y sus confirmaciones.
3. Si el guardado falla (validación o error de servidor), se aborta el cambio de
   estado y se muestra el error.

La intención de #90 se preserva: la notificación sale con datos frescos porque se
persisten **antes** de disparar el estado. Lo que cambia es que el operador deja
de hacer el round-trip manual.

## Arquitectura — inversión de control

El orquestador vive en `ReservationForm`, el único que tiene el estado del
formulario y la lógica de guardado. El componente de estado se mantiene tonto y
delega:

- `ReservationStatusActions`: se reemplaza el prop `hasUnsavedChanges?: boolean`
  por `onBeforeStatusChange?: () => Promise<boolean>`. Antes de despachar el
  cambio de estado, hace `await onBeforeStatusChange()`; si resuelve `false`
  (guardado falló o inválido), **aborta** sin llamar a `updateReservationStatus`.
  Si el prop está ausente (página de detalle, solo lectura) → comportamiento
  idéntico al actual.
- `ReservationForm`: provee el callback. Internamente:
  1. Si el form RHF está dirty → `persistReservation()`: valida con
     `await trigger()` (no con `handleSubmit`, que resuelve `void` y no expone el
     resultado), y si es válido construye el `FormData` desde `getValues()` y llama
     `updateReservation` **sin navegar**. Devuelve `boolean`: `false` si la
     validación falla (escribe el mensaje en `root` reusando la lógica de
     `onInvalid`) o si la acción devuelve `{ error }` (lo escribe en `root`);
     `true` tras el éxito, momento en que hace `reset(getValues())` para limpiar
     `dirtyFields`.
  2. Si el contacto del cliente está dirty → llama `handleSaveCustomer` (ahora
     devuelve `boolean`). Esta rama **no** llama `reset(...)`: `handleSaveCustomer`
     ya resetea su propio snapshot/draft (limpia `isCustomerDirty`) y su
     `router.refresh()` no refira el efecto de re-seed porque `customerId` no
     cambió (mismo invariante que documenta #90).
  3. Devuelve `true` solo si ambos pasos persistieron (o si no había nada dirty →
     no-op que resuelve `true`). El callback limpia sus banderas de carga en un
     `finally`: tras un abort el formulario queda editable y el operador puede
     reintentar.

### Orden de ejecución en el botón de estado

1. **Confirmaciones primero** (targets peligrosos / reactivación de estados
   consolidados). Barato; evita guardar y luego abortar si el operador cancela.
2. `await onBeforeStatusChange()` → autoguardado. Si `false`, abortar (el error ya
   se mostró: `root` del form o `customerError`).
3. Despachar `updateReservationStatus` → `router.refresh()` (igual que hoy).

El guardado del form no puede revertir el estado: `updateReservation` ya descarta
`status` del payload (issue #10), así que la transición sigue siendo válida cuando
se despacha el estado justo después.

## Manejo de errores (todos abortan el cambio de estado)

- Form inválido → error en `root` (reusa `onInvalid`) + toast; `updateReservation`
  no persiste, `updateReservationStatus` no se llama.
- Error de servidor en `updateReservation` → `root`; estado intacto.
- Contacto inválido / error de servidor → `customerError`; estado intacto.
- Error de transición de estado → manejo existente sin cambios.

## Blast radius

- `components/forms/reservation-form.tsx` — factorizar `persistReservation`
  (guardado sin navegar + `reset`), añadir el orquestador `onBeforeStatusChange`,
  hacer que `handleSaveCustomer` devuelva `boolean`.
- `components/layout/reservation-status-actions.tsx` — de bloqueo a callback
  async; reordenar confirm → save → dispatch.
- `tests/unit/components/reservation-form.test.tsx` y
  `tests/unit/components/reservation-status-actions.test.tsx`.
- `docs/specs/2026-06-16-issue-153-autosave-on-status-change/scenarios/`.
- **Sin cambios** en `lib/actions/*`, API, auth, schema ni el motor de
  notificaciones. `app/(dashboard)/reservations/[id]/page.tsx` sin cambios (prop
  opcional ausente → default actual).

## Impacto en escenarios de #90

Esta mejora invierte deliberadamente el contrato observable de #90: de *bloquear*
a *autoguardar-y-proceder*. Los holdout SCEN-001..003, 005, 007, 008 de #90 que
afirman bloqueo quedan **superseded** por los nuevos escenarios de este spec. Las
regresiones anti-falso-dirty de #90 (SCEN-004 montaje, SCEN-009 revert numérico)
se **conservan** reformuladas: en vez de "no bloquea" ahora afirman "no autoguarda
de más" (no llama a `updateReservation` por un cambio inexistente).

## Estrategia de satisfacción

Unit tests con `@testing-library/react` + `jsdom`. Mocks: `updateReservation`,
`updateReservationStatus`, `updateCustomerContact`, `sonner`, `window.confirm`. El
oráculo es doble:

- **Presencia**: qué acciones se llamaron / no se llamaron.
- **Orden**: `mock.invocationCallOrder` confirma que `updateReservation` /
  `updateCustomerContact` corrieron **antes** de `updateReservationStatus`.

Gotcha heredado de #90: Radix Select no renderiza opciones en jsdom; los campos
del camino `setValue` se conducen vía el checkbox "Conductor adicional", que
comparte el wiring `setValue(..., { shouldDirty: true })`.

Aceptación runtime (no unit): QA en navegador real sobre branch Supabase de
testing — editar lugar de recogida sin guardar, pulsar "Reservado", verificar que
la reserva queda persistida con el dato nuevo **y** el estado cambiado en un solo
clic, 0 errores de consola, 0 requests fallidos.
