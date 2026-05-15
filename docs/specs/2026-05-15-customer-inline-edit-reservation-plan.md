# Plan de implementación — Editar cliente inline en reserva

**Spec:** `docs/specs/2026-05-15-customer-inline-edit-reservation-design.md`
**Issue:** [#36](https://github.com/amaw-sas/rentacar-dashboard/issues/36)
**Fecha:** 2026-05-15
**Complejidad global:** S–M · **Riesgo:** Bajo

## Chunk 1: Implementación completa

### Mapa de archivos

| Archivo | Acción | Responsabilidad única |
|---------|--------|------------------------|
| `lib/schemas/customer.ts` | Modificar | Añade `customerContactSchema` (`.pick` de los 6 campos de contacto) + tipo `CustomerContactFormData`. No toca `customerSchema`. |
| `lib/actions/customers.ts` | Modificar | Añade `updateCustomerContact(id, formData)`. No toca `createCustomer`/`updateCustomer`. |
| `components/forms/reservation-form.tsx` | Modificar | Card "Cliente": inputs editables + estado local draft/snapshot + botón "Guardar cliente" + leyenda. Resto del form intacto. |
| `tests/unit/schemas/customer.test.ts` | Modificar | Añade casos para `customerContactSchema` al archivo existente. |
| `tests/unit/actions/customers.test.ts` | Crear | Nuevo: cobertura de `updateCustomerContact` (Supabase mockeado). |

Decomposición por responsabilidad: schema (validación) → action (mutación) → UI (estado+interacción). Cada archivo conserva un propósito; `reservation-form.tsx` ya es grande pero el cambio se confina a la card Cliente — no se justifica un split unilateral (patrón establecido del repo: un form = un archivo).

### Prerequisitos

- Ninguna dependencia nueva. Stack existente (zod 4, react-hook-form 7, supabase ssr, vitest 4).
- Trabajar en la rama actual de feature.

### Pasos de implementación

- [ ] **Paso 1 — `customerContactSchema`** | Size: S | Deps: ninguna
  - En `lib/schemas/customer.ts`, añadir `customerContactSchema = customerSchema.pick({ first_name, last_name, identification_type, identification_number, phone, email })` y `export type CustomerContactFormData`.
  - **Escenario (SDD):** dado un payload de contacto válido → `safeParse` éxito; dado email inválido / `first_name` vacío / `last_name` vacío / `identification_number` vacío / `identification_type` fuera del enum → `safeParse` falla con issue correspondiente; dado `phone: ""` → éxito (único string no requerido); el tipo inferido NO contiene `notes` ni `status`.
  - Encodear en `tests/unit/schemas/customer.test.ts` (extender, no recrear).
  - **Aceptación:** nuevos tests verdes; `customerSchema` y sus tests existentes sin cambios.

- [ ] **Paso 2 — Action `updateCustomerContact`** | Size: M | Deps: Paso 1
  - En `lib/actions/customers.ts`, añadir `updateCustomerContact(id, formData)`: `Object.fromEntries` → `customerContactSchema.safeParse` → primer issue como `{ error }`; `createClient()` (server, RLS) → `.from("customers").update(parsed.data).eq("id", id)`; mapeo `23505 + "identification_number"` → `"Ya existe un cliente con ese número de identificación"`; otro error → `error.message`; éxito → `revalidatePath("/customers")` + `revalidatePath("/reservations")` → `{}`.
  - **Escenario (SDD):** dado FormData de contacto válido → `.update` recibe exactamente los 6 campos (sin `notes`/`status`) y devuelve `{}`; dado email inválido → `{ error }` sin llamar a Supabase; dado error Supabase `23505` sobre `identification_number` → mensaje amigable; dado otro error Supabase → `error.message`.
  - Encodear en `tests/unit/actions/customers.test.ts` (crear). Mock de `@/lib/supabase/server` con builder encadenable `.from().update().eq()` y mock de `next/cache.revalidatePath` — **extensión** del patrón `vi.mock` de `tests/unit/actions/auth.test.ts`, no copia directa (auth mockea `next/navigation` plano, no el chain ni `next/cache`).
  - **Aceptación:** tests verdes; assertion explícita de que el objeto pasado a `.update` no contiene `notes` ni `status`.

- [ ] **Paso 3 — Estado local de cliente en `reservation-form.tsx`** | Size: M | Deps: ninguna
  - Añadir `customerDraft` y `customerSnapshot` (`useState`) con shape `{ first_name, last_name, identification_type, identification_number, phone, email }`. `useEffect` keyed en `customerId` re-siembra ambos desde `selectedCustomer` (o vacíos si no hay selección). `isCustomerDirty` = comparación shallow `draft` vs `snapshot`.
  - Reemplazar los 5 `Input readOnly` por: `Nombre` + `Apellido` (inputs separados), `Tipo identificación` como `Select` (CC/CE/NIT/PP/TI — reusar las opciones de `customer-form.tsx`), `Identificación`, `Teléfono`, `Email` editables, todos bound a `customerDraft`. Inputs deshabilitados si no hay cliente seleccionado.
  - **Escenario (SDD):** dado ningún cliente seleccionado → inputs deshabilitados (escenario 5 base); dado cambio de cliente en el combobox con draft sucio → inputs re-sembrados con el nuevo cliente, edición previa descartada (escenario 6); dado draft == snapshot → `isCustomerDirty` false (escenario 7).
  - Verificación: type-check + lint + render manual del form (sin regresión visual en el resto de cards).
  - **Aceptación:** los campos del cliente se editan en estado local; el submit de la reserva sigue sin incluir campos de cliente (no están en `reservationSchema`); cambiar de cliente re-siembra.

- [ ] **Paso 4 — Botón "Guardar cliente" + wiring** | Size: M | Deps: Pasos 2, 3
  - Añadir botón `type="button"` "Guardar cliente" en el footer de la card Cliente; habilitado solo si hay cliente seleccionado **y** `isCustomerDirty` **y** no guardando (`savingCustomer` local). Leyenda fija: *"Editar afecta los datos del cliente en todas sus reservas."*
  - Handler: `customerContactSchema.safeParse(draft)` → fallo: error inline en la card, fin; éxito: build FormData → `await updateCustomerContact(customerId, fd)` → `result.error`: mostrar inline; éxito: `setCustomerSnapshot(draft)` + `router.refresh()`.
  - **Escenario (SDD):** dado email corregido y click → persiste, combobox refleja el cambio tras refresh, form de reserva conserva valores (escenario 1); dado cliente con `notes`/`status="inactive"` y cambio de teléfono guardado → `notes`/`status` intactos en BD (escenario 2 — cubierto por el `.update` parcial del Paso 2, verificado en runtime); dado email inválido → error inline, sin llamada a BD, reserva intacta (escenario 3); dado identificación duplicada → mensaje amigable inline, reserva intacta (escenario 4).
  - **Aceptación:** botón no dispara el submit de la reserva; éxito resetea dirty y sincroniza combobox; error se muestra inline sin afectar la reserva.

- [ ] **Paso 5 — Verificación runtime (agent-browser + dogfood)** | Size: M | Deps: Paso 4
  - Levantar dev server; en la edición de una reserva real: ejecutar escenario 1 (corregir email, guardar, verificar persistencia + combobox + form de reserva intacto) y escenario 2 (cliente con notes/status inactive: cambiar teléfono, guardar, verificar en BD que `notes`/`status` no cambiaron).
  - QA exploratorio del resto del form (sin regresión). Cero errores de consola, cero requests fallidos.
  - **Aceptación:** los 7 escenarios del spec observados; evidencia fresca capturada para `/verification-before-completion`. La etiqueta del combobox transitoriamente obsoleta tras `router.refresh()` (ventana async, spec "Nota de timing") NO se marca como bug — verificar tras resolver el refresh.

### Testing Strategy

- **Unit (vitest):** Paso 1 (schema) y Paso 2 (action) — escenarios encodeados *dentro* del paso, no como pasos separados.
- **Runtime (agent-browser + dogfood):** Paso 5 — escenarios 1 y 2 end-to-end en dashboard real; escenario 2 valida en BD que `notes`/`status` no mutaron.
- **Gate CI existente:** type-check → lint → test → build (secuencial, todos deben pasar).

### Rollout

- Sin migración de BD, sin variables de entorno nuevas, sin cambio de contrato de API pública.
- Deploy estándar Vercel vía PR a `main` tras CI verde.
- **Rollback:** revertir el PR — cambio aislado a 3 archivos de producción, sin estado persistente nuevo. El comportamiento previo (campos readonly) se restaura íntegro.
- **Monitoreo:** ninguno especial; observar logs de Vercel ante errores de `updateCustomerContact` en las primeras ediciones.

### Mapa escenario → paso

| Escenario spec | Paso que lo satisface |
|---|---|
| 1 (editar email, persiste + combobox) | 4 (unit parcial) + 5 (runtime) |
| 2 (notes/status intactos) | 2 (unit) + 5 (runtime BD) |
| 3 (email inválido, reserva intacta) | 4 |
| 4 (identificación duplicada inline) | 2 (unit) + 4 |
| 5 (sin cliente → botón disabled) | 3 / 4 |
| 6 (cambio de cliente re-siembra) | 3 |
| 7 (sin dirty → botón disabled) | 3 / 4 |
