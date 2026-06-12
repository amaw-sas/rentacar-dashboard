# Plan de implementación — Issue #90: bloquear cambio de estado con cambios sin guardar

**Spec:** `docs/specs/2026-06-12-issue-90-status-unsaved-guard-design.md`
**Issue:** [#90](https://github.com/amaw-sas/rentacar-dashboard/issues/90)
**Fecha:** 2026-06-12
**Branch / worktree:** `task/issue-90-status-unsaved-guard` · `.worktrees/issue-90`

## Chunk 1: Guard de cambios sin guardar

### Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `components/layout/reservation-status-actions.tsx` | Modificar | Añadir prop opcional `hasUnsavedChanges?: boolean` (default `false`) y un guard al inicio de `handleTransition` que, si es `true`, muestra aviso + toast y **retorna sin disparar**. Única responsabilidad nueva: rechazar el cambio de estado cuando el contexto padre tiene ediciones sin guardar. |
| `components/forms/reservation-form.tsx` | Modificar | Suscribir `isDirty` del `formState` de react-hook-form, calcular `hasUnsavedChanges = isDirty \|\| isCustomerDirty` y pasarlo al `<ReservationStatusActions>`. Única responsabilidad nueva: exponer el estado dirty combinado al componente de estado. |
| `app/(dashboard)/reservations/[id]/page.tsx` | **No tocar** | Omite el prop → default `false` → comportamiento intacto. Listado aquí para fijar que NO se modifica (verificación de blast radius). |
| `tests/unit/components/reservation-form.test.tsx` | Modificar | Codificar SCEN-001…006 como tests. Ya mockea `updateReservationStatus` y renderiza el form completo con los botones de estado cuando hay `id`. |

Decomposición: dos archivos de producción con fronteras limpias. El componente de
estado no sabe *por qué* hay cambios sin guardar (solo recibe un booleano); el
formulario es el único que conoce las dos fuentes de dirty. El prop opcional hace
el cambio aditivo: ningún consumidor existente rompe. Ningún archivo crece de
forma inmanejable (ambos cambios son <15 líneas netas).

### Prerrequisitos

- Worktree `.worktrees/issue-90` ya creada desde `main` (commit base `2f8b875`).
- Spec ya commiteada (`4ab082e`).
- Para QA runtime (Step 3): dev server con `.env.testing` cargado
  (`set -a && . ./.env.testing && set +a && pnpm dev`); login QA en branch
  Supabase de testing según procedimiento conocido. Copiar `.env.testing` a la
  worktree vía Write (Bash bloquea `.env*`).

### Pasos

- [ ] **Step 1 — Guard en `ReservationStatusActions` | Size: S | Dependencies: none**

  Añadir el prop opcional y el short-circuit. El operador pulsa un botón de estado
  con `hasUnsavedChanges={true}` → el sistema muestra el aviso y **no** llama a
  `updateReservationStatus`; con `false`/ausente → flujo actual intacto.

  Detalle:
  - Extender `ReservationStatusActionsProps` con `hasUnsavedChanges?: boolean`.
  - Al inicio de `handleTransition`, **antes** de los `window.confirm`
    (`DANGEROUS_TARGETS` / `CONSOLIDATED_SOURCES`) y de la acción:
    ```tsx
    if (hasUnsavedChanges) {
      const message =
        "Tienes cambios sin guardar en el formulario. Guárdalos antes de cambiar el estado para que la notificación use los datos correctos.";
      setError(message);
      toast.error("Cambios sin guardar", {
        description: "Guarda el formulario antes de cambiar el estado.",
      });
      return;
    }
    ```
  - Reutiliza el `error` state existente (línea 51) y su render (línea 108) y el
    `toast` ya importado (línea 13). Sin estado nuevo.

  Escenarios (tests en `reservation-form.test.tsx`, salvo SCEN-006 que puede
  renderizar el componente directo):
  - **SCEN-006** — `ReservationStatusActions` sin prop `hasUnsavedChanges` →
    clic en botón de estado válido → `updateReservationStatus` **sí** se llama.
  - **Guard unit** — `ReservationStatusActions` con `hasUnsavedChanges={true}` →
    clic → `updateReservationStatus` **no** se llama y aparece el aviso.

  Acceptance:
  - `pnpm test` verde para ambos escenarios.
  - El guard va antes de cualquier `confirm`: con `hasUnsavedChanges={true}` y un
    target peligroso (p. ej. `cancelado`), no aparece el `window.confirm`.

- [ ] **Step 2 — Cablear dirty desde el formulario + gate anti falso-dirty | Size: S | Dependencies: Step 1**

  El operador edita un campo del form (o el contacto del cliente) sin guardar →
  pulsa un botón de estado → bloqueado con aviso. Sin cambios → dispara normal.

  Detalle:
  - En `reservation-form.tsx`, añadir `isDirty` al destructuring de `formState`
    (hoy `{ errors, isSubmitting }`, línea 143).
  - Calcular `const hasUnsavedChanges = isDirty || isCustomerDirty;`
    (`isCustomerDirty` ya existe, líneas 241-247).
  - Pasar `hasUnsavedChanges={hasUnsavedChanges}` al `<ReservationStatusActions>`
    (línea 492).

  **Gate anti falso-dirty (SCEN-004, bloqueante):** RHF compara contra
  `defaultValues`; los inputs numéricos con `register("selected_days")` /
  `register("coverage_days")` / `register("extra_hours")` emiten *string* vs
  defaults *number* → posible `isDirty=true` al montar sin editar nada. Si SCEN-004
  falla (el form recién cargado bloquea el estado), aplicar la mitigación preferida:
  sustituir `isDirty` por `Object.keys(formState.dirtyFields).length > 0` (toca
  solo el path de lectura de esta feature; no perturba submit ni resolver zod).
  Re-correr SCEN-004 hasta verde.

  Escenarios (tests):
  - **SCEN-001** — campo del form cambiado (p. ej. lugar de recogida) → clic
    estado → `updateReservationStatus` **no** llamado + aviso visible.
  - **SCEN-002** — contacto del cliente editado (form de reserva limpio), sin
    "Guardar cliente" → clic estado → `updateReservationStatus` **no** llamado.
  - **SCEN-003** — sin cambios → clic estado válido → `updateReservationStatus`
    **sí** llamado con `(reservationId, newStatus)`.
  - **SCEN-004** — form recién montado desde reserva existente, sin ediciones →
    clic estado → `updateReservationStatus` **sí** llamado (no hay falso-dirty).
  - **SCEN-005** — form limpio salvo draft de cliente; "Guardar cliente" con éxito
    resetea `isCustomerDirty` → clic estado → `updateReservationStatus` **sí**
    llamado (desbloqueo sin recargar).

  Acceptance:
  - `pnpm test` verde para SCEN-001…005.
  - `pnpm type-check` y `pnpm lint` limpios.
  - SCEN-004 es gate: no se da el step por hecho si el form recién cargado bloquea.

- [ ] **Step 3 — Verificación runtime + cierre | Size: S | Dependencies: Step 2**

  Validación end-to-end del flujo real en navegador (el bug es de UI), no solo
  unit. Constraint del proyecto: cambios web exigen validación runtime con
  agent-browser + dogfood, cero errores de consola / requests fallidos.

  Detalle / verificación manual:
  1. Dev server con `.env.testing`; login QA en branch de testing.
  2. Abrir edición de una reserva existente → **sin editar nada**, pulsar un botón
     de estado → debe **disparar** (confirma SCEN-004 en runtime, no solo unit).
  3. Editar el lugar de recogida (sin guardar) → pulsar botón de estado → debe
     **bloquear** con el aviso; `updateReservationStatus` no se ejecuta.
  4. Pulsar "Guardar cambios" → reintentar estado → dispara.
  5. Editar contacto del cliente (sin "Guardar cliente") → botón de estado →
     bloquea; tras "Guardar cliente" → dispara.
  6. Revisar consola: cero errores; pestaña Network: sin requests fallidos.

  Acceptance:
  - Pasos 2-5 observados según lo esperado vía agent-browser/dogfood.
  - Cero errores de consola, cero requests fallidos.
  - Invocar `/verification-before-completion` con evidencia fresca antes de
    cualquier claim de "done" / commit de implementación / PR.

## Estrategia de testing

- **Unit (vitest + RTL):** SCEN-001…006 en `reservation-form.test.tsx`. El mock de
  `updateReservationStatus` es el oráculo "disparó / no disparó". SCEN-006 puede
  necesitar importar `ReservationStatusActions` directo (hoy el test solo importa
  `ReservationForm`) o cubrirse vía SCEN-003/004.
- **Runtime (agent-browser + dogfood):** Step 3, flujo real en branch de testing.
- **CI gate:** type-check → lint → test → build, todo verde (es el gate de merge).

## Rollout

- **Deploy:** cambio client-only, sin migraciones ni env vars nuevas. Sigue el
  flujo normal: PR a `main` → CI verde → merge → Vercel deploy automático.
- **Monitoreo:** tras merge, validar en producción que cambiar estado tras editar
  sin guardar muestra el aviso (smoke manual). No requiere query de BD.
- **Rollback:** revert del PR; sin estado persistido ni schema que deshacer.

## Open questions

- Ninguna bloqueante. La única decisión diferida (usar `isDirty` vs `dirtyFields`)
  se resuelve por evidencia en el gate SCEN-004 del Step 2.
