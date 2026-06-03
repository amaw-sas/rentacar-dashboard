---
name: customer-snapshot
created_by: claude
created_at: 2026-06-02T00:00:00Z
issue: 26
related: [25]
---

# Issue #26 — snapshot de datos del cliente al momento del booking

`reservations` solo enlaza al cliente por `customer_id`. Todo read path sigue ese FK y
renderiza la fila **actual** de `customers`, así que cualquier `UPDATE` al cliente
(typo, merge, bug) reescribe el dueño aparente de toda reserva histórica. Causa próxima
del incidente 2026-05-12 (ver [[incident_customer_record_mutation_2026_05_12]]). Fix:
5 columnas snapshot en `reservations`, pobladas al INSERT, congeladas salvo
re-snapshot sancionado (reassign / edición inline de contacto).

Decisiones de producto (usuario, 2026-06-02): ID en dos columnas (type+number);
notificaciones siguen **vivas** (consistente con #87/#89); backfill desde customers
actual; reassign y edición inline re-snapshotean. Diseño completo en
`../2026-06-02-issue-26-customer-snapshot-design.md`.

Holdout para `/scenario-driven-development`. Satisfacer el comportamiento observable —
no debilitar un escenario para que pase el código.

---

## SCEN-001: edición global del cliente NO altera reservas históricas (anti-corrupción, núcleo)

**Given**: una reserva creada para el cliente "Jose" (snapshot = "Jose").
**When**: un admin edita ese cliente a "test90" **desde la sección Clientes global**.
**Then**: el listado de reservas, el detalle, el libro, el home del dashboard y el
detalle de referral siguen mostrando "Jose"; el perfil del cliente muestra "test90".

Razón observable: es el corazón del issue. La fila de la reserva nunca se UPDATEa por
una edición global → el snapshot queda congelado.

## SCEN-002: write API persiste snapshot = customer row (incl. variante colisión #25)

**Given**: `POST /api/reservations` con datos de cliente.
**When**: la reserva se inserta.
**Then**: las 5 columnas snapshot igualan la fila de `customers` resuelta por
`customer_id` en ese momento.
**Variante (colisión CC)**: POST con `first_name` distinto pero `identification_number`
colisionando con un cliente existente → el snapshot refleja la **fila existente** (lo
que `customer_id` apunta bajo #25 lenient), NO el body enviado-y-descartado.

Razón observable: ancla el snapshot a la verdad del FK, no al input crudo; anti-gaming
contra una implementación ingenua "snapshot desde el request body".

## SCEN-003: write dashboard create persiste snapshot

**Given**: `createReservation` con un `customer_id` preseleccionado en el form.
**When**: la reserva se inserta.
**Then**: las 5 columnas snapshot quedan pobladas desde ese cliente.

## SCEN-004: reassign re-snapshotea a los datos del nuevo cliente

**Given**: una reserva cuyo `customer_id` se cambia a un cliente Y vía edición.
**When**: se guarda.
**Then**: las 5 columnas snapshot pasan a los valores de Y (re-snapshot vía RPC, sin
rechazo del trigger).

## SCEN-005: edición normal NO toca el snapshot (invariante no-drift)

**Given**: una reserva editada (p.ej. `pickup_date`) **sin** cambiar `customer_id`,
mientras la fila del cliente fue mutada entremedio.
**When**: se guarda.
**Then**: las columnas snapshot quedan intactas. No se llama la RPC.

Razón observable: distingue edición-de-reserva de re-snapshot; sin esto, cada edición
re-introduciría la corrupción.

## SCEN-006: el trigger rechaza drift que no coincide con el cliente

**Given**: un `UPDATE` directo que setea una columna snapshot a un valor que NO coincide
con la fila de `customers` de `customer_id` (con `customer_id` sin cambiar).
**When**: se ejecuta.
**Then**: el trigger lanza excepción `reservations snapshot must match the customers row`.

Razón observable: el guard es value-based, no "rechaza todo cambio". SCEN-004/009
prueban que un cambio *coincidente* sí pasa; SCEN-006 que un cambio *no coincidente* se
rechaza — juntos delimitan la frontera accept/reject (no satisfacible con un guard
trivial).

## SCEN-007: las notificaciones siguen vivas (non-goal explícito)

**Given**: se corrige el email de un cliente y se reenvía una notificación.
**When**: el resend dispara.
**Then**: va al email **actual** (vivo), no al snapshot — consistente con #87/#89.

Razón observable: el snapshot es solo display/forensic; no debe alterar la resolución
de destinatario. Verifica que email/WATI/GHL/reminders NO migraron al snapshot.

## SCEN-008: backfill puebla todas las filas previas y queda NOT NULL

**Given**: reservas creadas antes de la migración.
**When**: corre el backfill.
**Then**: cada reserva tiene las 5 columnas snapshot pobladas desde el customer actual,
y las columnas son NOT NULL.

## SCEN-009: edición inline de contacto re-snapshotea SOLO esta reserva

**Given**: la reserva R del cliente X, que tiene dos reservas.
**When**: un operador edita el contacto de X **desde el form de R** (botón guardar
cliente).
**Then**: el display de R se actualiza al nuevo contacto; la otra reserva de X queda
congelada en el contacto viejo. El trigger permite el write de R porque coincide con el
X actualizado.

Razón observable: la corrección explícita sobre R se refleja; las otras reservas de X
quedan protegidas (no es una edición global).

## SCEN-010: customer_id que no resuelve → la action retorna {error}, no lanza

**Given**: el form de creación envía un `customer_id` UUID válido que ya no resuelve a
una fila de `customers` (hard-delete TOCTOU, o form viejo/cacheado).
**When**: `createReservation` corre y la lectura del snapshot no halla el cliente.
**Then**: la action retorna `{ error }` (mostrable como toast); NO lanza al cliente; el
insert de la reserva nunca se ejecuta.

Razón observable: regresión descubierta en Step 2-4 (edge-case-detector, conf 0.88).
Pre-#26 un `customer_id` inexistente caía al FK error y se devolvía gracioso; la lectura
del snapshot (que lanza en `.single()` sin fila) debe preservar el contrato de actions
(`conventions.md`: "lib/actions/ retorna {error} — nunca throw al cliente"). El caller
(`reservation-form.tsx`) chequea `result.error`; un rejection se tragaría sin toast.
La ruta pública API ya está protegida por su try/catch externo (no necesita fix).

**Evidence**: test `returns { error } (does not throw) when the customer row is missing`
en `tests/unit/actions/reservations.test.ts`; `sb.insert` verificado `not.toHaveBeenCalled()`.

## SCEN-011: read paths adyacentes (búsqueda + comisiones) también muestran el snapshot

**Given**: una reserva cuyo cliente "Jose" fue editado globalmente a "test90".
**When**: (a) un operador busca "Jose" en el filtro del listado de reservas;
(b) abre el detalle de una comisión vinculada a esa reserva;
(c) busca esa reserva en el form de vinculación de comisiones.
**Then**: (a) el filtro la encuentra por "Jose" (lo que muestra la UI) y NO por "test90";
(b) el detalle de comisión muestra "Jose"; (c) el picker muestra "Jose".

Razón observable: extensión de scope aprobada por el usuario (2026-06-03). Adyacentes a
los 5 surfaces de SCEN-001 pero misma clase de bug anti-corrupción: todo read path
atado a la reserva debe seguir el snapshot, no el join vivo. El filtro de búsqueda es la
misma superficie del listado — si buscara por el join vivo, el operador no podría hallar
la reserva por la identidad que la UI le muestra. Notificaciones y el perfil del cliente
quedan FUERA (viven por diseño, ver SCEN-007 / SCEN-001).

**Evidence**: tests `matchesSearch predicate — snapshot-aware` en
`tests/unit/components/reservations-table-filters.test.tsx` (red-green verificado:
4 fallos con lógica join-vivo, 12/12 con snapshot); selects con `customer_name_at_booking`
en `lib/queries/commissions.ts` (COMMISSION_SELECT) y `commission-link-form.tsx`; renders
con fallback `customer_name_at_booking ?? <join>` en `commissions/[id]/page.tsx` y
`commission-link-form.tsx`. Detalle de comisión + picker: QA runtime en Step 11.
