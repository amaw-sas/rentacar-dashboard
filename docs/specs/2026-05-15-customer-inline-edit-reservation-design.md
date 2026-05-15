# Editar datos del cliente desde la edición de reserva

**Issue:** [#36](https://github.com/amaw-sas/rentacar-dashboard/issues/36)
**Fecha:** 2026-05-15
**Estado:** Diseño aprobado

## Problema

En la edición de reserva los campos del cliente (nombre, tipo de identificación,
identificación, teléfono, email) son `readOnly` (`components/forms/reservation-form.tsx:250-308`).
Para corregir un dato mal cargado el operador debe salir del flujo de la reserva,
abrir el detalle del cliente, editar, guardar y volver. Esa fricción provoca
errores sin corregir o clientes duplicados creados para "salir del paso".

## Decisión

Opción A del issue: edición inline de los campos de contacto del cliente dentro
del formulario de reserva, con un botón **"Guardar cliente"** independiente del
submit de la reserva.

Alcance acordado:

- **Campos editables:** solo contacto — `first_name`, `last_name`,
  `identification_type`, `identification_number`, `phone`, `email`.
  Fuera de alcance: `notes`, `status` (se editan desde `customer-form.tsx`).
- **Unicidad de identificación:** mensaje amigable del server action (mapeo del
  error Postgres `23505`) mostrado inline. Sin query de pre-check.

## Arquitectura

### Capa de datos — nuevo schema enfocado

`lib/schemas/customer.ts` añade, sin modificar `customerSchema`:

```ts
export const customerContactSchema = customerSchema.pick({
  first_name: true,
  last_name: true,
  identification_type: true,
  identification_number: true,
  phone: true,
  email: true,
});

export type CustomerContactFormData = z.infer<typeof customerContactSchema>;
```

### Capa de mutación — nueva server action

`lib/actions/customers.ts` añade `updateCustomerContact`, junto a
`createCustomer`/`updateCustomer` (que NO se modifican):

```ts
export async function updateCustomerContact(
  id: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerContactSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update(parsed.data)         // solo las 6 columnas de contacto
    .eq("id", id);

  if (error) {
    if (error.code === "23505" && error.message.includes("identification_number")) {
      return { error: "Ya existe un cliente con ese número de identificación" };
    }
    return { error: error.message };
  }

  revalidatePath("/customers");
  revalidatePath("/reservations");
  return {};
}
```

Propiedades:

- `.update(parsed.data)` toca **solo las 6 columnas de contacto** → `notes` y
  `status` permanecen intactos (sin pérdida de datos).
- Server client con RLS (patrón existente del archivo). No se expone en `app/api/`.
- Convención de errores de `lib/actions/`: devuelve `{ error?: string }`,
  nunca lanza al cliente.

### Capa UI — `components/forms/reservation-form.tsx`

Cambios en la card "Cliente":

1. Los 5 inputs `readOnly` pasan a **editables**, vinculados a estado local de
   React (`customerDraft`), NO a `react-hook-form` — los campos del cliente no
   forman parte de `reservationSchema`.
2. "Nombre" combinado se divide en **Nombre + Apellido** (el schema los persiste
   separados).
3. "Tipo identificación" pasa de `Input` a **`Select`** (CC/CE/NIT/PP/TI, mismas
   opciones que `customer-form.tsx`).
4. Botón **"Guardar cliente"** con `type="button"` en el footer de la card
   Cliente — no dispara el `handleSubmit` de la reserva.
5. Leyenda fija junto al botón: *"Editar afecta los datos del cliente en todas
   sus reservas."*

### Modelo de estado — dirty separado

- `customerSnapshot`: último estado persistido, sembrado desde `selectedCustomer`.
- `customerDraft`: estado editable de los inputs.
- `useEffect` keyed en `customerId` re-siembra ambos al cambiar de cliente en el
  combobox (descarta edición no guardada — comportamiento aceptado).
- `isCustomerDirty = !shallowEqual(customerDraft, customerSnapshot)`.
- Botón "Guardar cliente" habilitado solo si: hay cliente seleccionado **y**
  `isCustomerDirty` **y** no está guardando.
- Al guardar OK: `setCustomerSnapshot(customerDraft)` (dirty se resetea) +
  `router.refresh()` para sincronizar la etiqueta/lista del combobox desde el
  server component. El estado de la reserva (RHF) sobrevive `router.refresh()`
  porque el componente no se remonta y el estado de RHF es interno.
- Al fallar: error inline en la card Cliente; el submit de la reserva nunca se
  ve afectado.

### Validación

- Client-side: `customerContactSchema.safeParse` antes de invocar la action;
  primer issue mostrado inline.
- Unicidad: mensaje amigable del action (mapeo `23505`) mostrado inline.

## Flujo de datos

```
Operador edita campos cliente (inputs locales)
  → customerDraft cambia → isCustomerDirty = true → botón habilitado
  → click "Guardar cliente"
    → customerContactSchema.safeParse (client)
       fallo → error inline, fin (reserva intacta)
       ok → FormData → updateCustomerContact(customerId, fd)
            error → error inline (reserva intacta)
            ok → setCustomerSnapshot(draft); router.refresh()
                 → server component re-renderiza con customers fresco
                 → combobox refleja el nuevo nombre
```

El submit principal de la reserva (`onSubmit`) no cambia: nunca persiste campos
del cliente (no están en `reservationSchema`).

## Blast radius

- **Modificados:**
  - `lib/schemas/customer.ts` — añade `customerContactSchema` (+ tipo).
  - `lib/actions/customers.ts` — añade `updateCustomerContact`.
  - `components/forms/reservation-form.tsx` — UI + estado local del cliente.
- **No modificados:** `updateCustomer`, `customerSchema`, `customer-form.tsx`
  → cero impacto en el flujo de clientes existente.
- **Nuevo:** `tests/unit/actions/customers.test.ts` (action) +
  `tests/unit/schemas/customer.test.ts` (schema, si no existe).
- **Consumidores** de `updateCustomer`/`customerSchema`: ninguno afectado
  (se agrega, no se modifica).
- **Docs:** este spec; issue #36.

## Escenarios observables

| # | Dado | Cuando | Entonces |
|---|------|--------|----------|
| 1 | Reserva en edición con cliente seleccionado | Corrijo el email y pulso "Guardar cliente" | El email persiste, el combobox refleja el cambio sin recarga manual, y el form de reserva conserva sus valores |
| 2 | Cliente con `notes` y `status="inactive"` | Edito su teléfono desde la reserva y guardo | `notes` y `status` permanecen sin cambios en la BD |
| 3 | Email inválido en el draft | Pulso "Guardar cliente" | Error inline, no se llama a la BD, el form de reserva no se altera |
| 4 | Identificación ya usada por otro cliente | Guardo | "Ya existe un cliente con ese número de identificación" inline, reserva intacta |
| 5 | Ningún cliente seleccionado | Miro la card Cliente | Botón "Guardar cliente" deshabilitado |
| 6 | Draft con cambios sin guardar | Cambio de cliente en el combobox | Campos re-sembrados con el nuevo cliente (edición previa descartada) |
| 7 | Draft sin cambios respecto al snapshot | Miro el botón | Botón "Guardar cliente" deshabilitado (no dirty) |

## Estrategia de verificación

- **Unit (vitest):**
  - `customerContactSchema`: rechaza email inválido, campos requeridos vacíos
    (`first_name`/`last_name`/`identification_number`) e `identification_type`
    fuera del enum; acepta `phone: ""` (único string no requerido); acepta
    payload de contacto válido; no incluye `notes`/`status`.
  - `updateCustomerContact`: happy path actualiza solo las 6 columnas; `23505`
    → mensaje amigable; fallo de zod → primer issue; mock de Supabase verifica
    que `.update` recibe solo campos de contacto (sin `notes`/`status`).
- **Nota de timing (para planning/verificación):** `router.refresh()` es
  asíncrono. El `customerSnapshot` local se actualiza antes de que el server
  component re-provea `customers`; existe una ventana breve donde la etiqueta
  del combobox sigue obsoleta. Escenario 1 ("sin recarga manual") se cumple
  tras resolver el refresh — la verificación runtime no debe marcar esa
  etiqueta transitoriamente obsoleta como bug.
- **Runtime (agent-browser + dogfood):** flujo escenario 1 y 2 en el dashboard
  real — editar y guardar, verificar persistencia y combobox, cero errores de
  consola, cero requests fallidos.
- Gate CI existente: type-check → lint → test → build.

## Fuera de alcance

- Crear cliente nuevo desde la reserva (ya cubierto por combobox +
  `customer-form.tsx`).
- Editar `notes`/`status` desde la reserva.
- Edición masiva de clientes.
- Audit trail / historial de cambios del cliente (issue separado si se requiere).
