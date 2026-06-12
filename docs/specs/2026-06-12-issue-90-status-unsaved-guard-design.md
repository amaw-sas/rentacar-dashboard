# Bloquear cambio de estado con cambios sin guardar del formulario

**Issue:** [#90](https://github.com/amaw-sas/rentacar-dashboard/issues/90)
**Fecha:** 2026-06-12
**Estado:** Diseño aprobado

## Problema

En la pantalla de edición de reserva, el **estado** y el **formulario** se
guardan por dos acciones independientes:

- **Estado** → `components/layout/reservation-status-actions.tsx` →
  `updateReservationStatus`. Persiste y **dispara la notificación al instante**,
  leyendo la reserva en vivo de la BD.
- **Formulario** → `components/forms/reservation-form.tsx` → `updateReservation`.
  Persiste al pulsar "Guardar cambios".

Como son independientes, un operador puede editar el lugar/fechas/precios en el
formulario (sin guardar todavía) y luego pulsar un botón de estado. La
notificación se dispara con los datos **aún sin guardar** (los viejos de la BD),
no los que el operador escribió en pantalla. El operador no tiene señal de error:
el correo sale con datos incorrectos.

Evidencia (reserva `CT78YR35344A`, código operativo interno, sin PII): el
operador cambió el lugar a Neiva en pantalla, aprobó el estado, y el email salió
con la ciudad vieja (Ibagué); recién después guardó el formulario.

El mismo footgun aplica al **draft de contacto del cliente** (nombre, email,
teléfono) editado inline (#36): tiene su propio botón "Guardar cliente", y si no
se guarda antes de cambiar el estado, la notificación va al email/teléfono viejo.

## Decisión

**Opción 1 del issue — bloquear + avisar**, con dos refinamientos acordados:

- **Mecanismo: aviso al hacer clic.** Los botones de estado siguen visibles. Al
  pulsar uno con cambios sin guardar, aparece un aviso y **no se dispara** la
  notificación. El operador guarda y reintenta. El clic es lo que explica el
  bloqueo (más descubrible que deshabilitar los botones).
- **Alcance: formulario + cliente.** Cuenta como "cambios sin guardar" tanto los
  campos del formulario de reserva (`isDirty` de react-hook-form) como el draft
  de contacto del cliente (`isCustomerDirty`, ya existente). Ambos alimentan la
  notificación.

Descartadas: preview en el diálogo de confirmación (expone la discrepancia pero
no la previene si el operador confirma sin leer) y unificar guardar+notificar
(acopla dos acciones independientes y mete la validación del form completo en el
botón de estado — más magia, más riesgo).

### Fuera de alcance

- No se modifica `updateReservationStatus`, `updateReservation`, ni el motor de
  notificaciones. El motor ya renderiza en vivo correctamente; el bug es de
  **orden de guardado** en la UI, no del envío.
- No se añade estado de servidor ni persistencia nueva. Todo es client-side.
- No se toca la página de detalle de reserva (solo lectura): ver "Componente
  compartido" abajo.

## Arquitectura

Cambio acotado a 2 archivos. El componente de estado se vuelve "guardable" por
un prop opcional; el formulario calcula y pasa el flag de dirty.

### Componente de estado — nuevo prop opcional

`components/layout/reservation-status-actions.tsx` añade un prop opcional
`hasUnsavedChanges?: boolean` (default `false`):

```tsx
interface ReservationStatusActionsProps {
  reservationId: string;
  currentStatus: ReservationStatus;
  hasUnsavedChanges?: boolean; // default false
}
```

En `handleTransition`, **antes** de cualquier `window.confirm` o llamada a
`updateReservationStatus`, se intercepta el clic:

```tsx
async function handleTransition(newStatus: ReservationStatus) {
  if (hasUnsavedChanges) {
    const message =
      "Tienes cambios sin guardar en el formulario. Guárdalos antes de cambiar el estado para que la notificación use los datos correctos.";
    setError(message);
    toast.error("Cambios sin guardar", {
      description: "Guarda el formulario antes de cambiar el estado.",
    });
    return; // no dispara: ni confirm, ni acción, ni notificación
  }

  // … lógica existente (DANGEROUS_TARGETS / CONSOLIDATED_SOURCES + acción)
}
```

El guard va **primero**, antes de los `confirm` de targets peligrosos: si hay
cambios sin guardar nunca debemos llegar a disparar nada.

### Componente compartido — la página de detalle no cambia

`ReservationStatusActions` se usa en **dos** sitios:

- `components/forms/reservation-form.tsx:492` — dentro del `<form>` de edición.
  **Aquí vive el footgun.**
- `app/(dashboard)/reservations/[id]/page.tsx:102` — página de detalle, solo
  lectura, sin formulario. **No hay cambios sin guardar que proteger.**

Al ser `hasUnsavedChanges` opcional con default `false`, la página de detalle
omite el prop y conserva el comportamiento actual idéntico. **No se modifica
`page.tsx`.**

### Formulario — calcula y pasa el dirty combinado

`components/forms/reservation-form.tsx`:

1. Suscribir `isDirty` del `formState` de react-hook-form (hoy solo se
   desestructuran `errors` e `isSubmitting`):

   ```tsx
   formState: { errors, isSubmitting, isDirty },
   ```

2. Calcular el flag combinado (`isCustomerDirty` ya existe, líneas 241-247):

   ```tsx
   const hasUnsavedChanges = isDirty || isCustomerDirty;
   ```

3. Pasarlo al componente de estado (línea 492):

   ```tsx
   <ReservationStatusActions
     reservationId={id}
     currentStatus={persistedStatus}
     hasUnsavedChanges={hasUnsavedChanges}
   />
   ```

## Flujo de datos

```
Formulario (client)
  ├─ react-hook-form isDirty ─┐
  └─ isCustomerDirty ─────────┤
                              ▼
                  hasUnsavedChanges = isDirty || isCustomerDirty
                              │ (prop)
                              ▼
        ReservationStatusActions.handleTransition
                              │
              ┌───────────────┴───────────────┐
       hasUnsavedChanges=true          hasUnsavedChanges=false
              │                                │
        aviso + return                  flujo actual:
        (no dispara)                    confirm → updateReservationStatus
                                        → notificación en vivo
```

Sin estado de servidor nuevo, sin tocar acciones ni notificaciones.

## Manejo de edge cases

- **Tras guardar el formulario:** `onSubmit` navega fuera con
  `router.push(getReturnTo("/reservations"))`. La recarga posterior monta un
  form limpio → `isDirty=false`. No hace falta resetear dirty en sitio.
- **Tras "Guardar cliente" inline:** `handleSaveCustomer` iguala draft y snapshot
  → `isCustomerDirty=false` **sin salir de la página**. Si el form tampoco está
  sucio, el estado se desbloquea ahí mismo: el operador puede guardar cliente y
  cambiar estado sin recargar.
- **Página de detalle:** prop ausente → `false` → nunca bloquea.
- **Combinación parcial:** si solo el cliente está sucio (form limpio) o
  viceversa, `hasUnsavedChanges` es `true` y bloquea. Correcto: cualquiera de los
  dos alimenta la notificación.

## Riesgo conocido — falso-dirty de react-hook-form

`formState.isDirty` compara los valores actuales contra `defaultValues`. Los
inputs numéricos registrados con `register("selected_days")`,
`register("coverage_days")`, `register("extra_hours")` devuelven **string**,
mientras los `defaultValues` correspondientes son **number**. Esto puede marcar
el form como dirty **al cargar, sin que el operador edite nada**, lo que
bloquearía el cambio de estado en cada apertura (falso positivo grave: convierte
el fix en un bloqueo permanente).

**Mitigación (decidir por evidencia durante implementación):**

1. Verificar empíricamente si hay falso-dirty al montar el form de edición sin
   tocar nada (escenario SCEN-004 abajo es el gate).
2. Si lo hay, opciones en orden de preferencia:
   - Usar `Object.keys(formState.dirtyFields).length > 0` en lugar de `isDirty`
     (dirtyFields solo marca campos realmente cambiados por el usuario). **Menor
     riesgo:** toca solo el path de lectura de esta feature, no perturba el
     submit ni la validación zod de los campos numéricos. **Preferida.**
   - Normalizar los `defaultValues` numéricos para que coincidan con el tipo que
     emite `register` (coerción consistente). Más invasiva: cambia lo que ven
     todos los consumidores de esos campos y podría filtrarse al resolver zod.
   - Comparar explícitamente como hace la sección de cliente (snapshot vs draft).

La elección final depende de qué revele la verificación; el diseño exige que
SCEN-004 pase antes de dar el cambio por terminado.

## Testing

Vitest 4 + `@testing-library/react`, ampliando
`tests/unit/components/reservation-form.test.tsx` (ya existe y mockea
`updateReservationStatus`). Cada escenario observable abajo se codifica como un
test; el mock del action es el oráculo de "disparó / no disparó".

## Escenarios observables (Given/When/Then)

- **SCEN-001 — bloqueo por campo del formulario.**
  Given el form de edición con un campo cambiado (p. ej. lugar de recogida),
  When el operador pulsa un botón de estado,
  Then `updateReservationStatus` **no** se llama y aparece el aviso de cambios
  sin guardar.

- **SCEN-002 — bloqueo por draft de cliente.**
  Given el form de edición con el contacto del cliente editado (form de reserva
  limpio) y sin pulsar "Guardar cliente",
  When el operador pulsa un botón de estado,
  Then `updateReservationStatus` **no** se llama y aparece el aviso.

- **SCEN-003 — sin cambios, dispara (comportamiento preservado).**
  Given el form de edición sin cambios pendientes,
  When el operador pulsa un botón de estado válido,
  Then `updateReservationStatus` **sí** se llama con `(reservationId, newStatus)`
  y se ejecuta el flujo actual.

- **SCEN-004 — form recién cargado no bloquea (gate anti falso-dirty).**
  Given el form de edición recién montado desde una reserva existente, sin
  ninguna edición del operador,
  When el operador pulsa un botón de estado,
  Then `updateReservationStatus` **sí** se llama (no hay falso-dirty que bloquee).

- **SCEN-005 — desbloqueo tras guardar cliente inline.**
  Given el form limpio salvo el draft de cliente editado, y el operador pulsa
  "Guardar cliente" con éxito,
  When pulsa un botón de estado,
  Then `updateReservationStatus` **sí** se llama (el guardado del cliente reseteó
  `isCustomerDirty` y desbloqueó sin recargar).

- **SCEN-006 — página de detalle nunca bloquea.**
  Given `ReservationStatusActions` montado sin el prop `hasUnsavedChanges` (uso de
  la página de detalle),
  When el operador pulsa un botón de estado,
  Then `updateReservationStatus` **sí** se llama (default `false`).
  Nota de implementación: el test file actual solo importa `ReservationForm`;
  este escenario requiere renderizar `ReservationStatusActions` directamente
  (nuevo import) o queda cubierto indirectamente por SCEN-003/004 (que ya
  ejercen el path prop-ausente vía el form).

## Blast radius

- **Archivos modificados:**
  - `components/layout/reservation-status-actions.tsx` (nuevo prop + guard).
  - `components/forms/reservation-form.tsx` (suscribir `isDirty`, pasar prop).
- **Archivos NO modificados (verificado):**
  `app/(dashboard)/reservations/[id]/page.tsx` (omite el prop, comportamiento
  intacto), `lib/actions/reservations.ts`, motor de notificaciones.
- **Consumidores de `ReservationStatusActions`:** los dos sitios listados arriba;
  ambos siguen compilando (prop opcional).
- **Tests:** `tests/unit/components/reservation-form.test.tsx` se amplía con
  SCEN-001…006.
- **Docs:** este spec; el plan lo genera sop-planning.
