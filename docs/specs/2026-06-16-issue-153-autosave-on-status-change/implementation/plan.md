# Plan de implementación — Issue #153 (autoguardar al cambiar de estado)

**Spec:** `../design.md` + `../scenarios/autosave-on-status-change.scenarios.md` (13 holdout SCEN).
**Worktree:** `.worktrees/issue-153-autosave-status` (branch `task/issue-153-autosave-status`).
**Modo:** SDD por paso — escenario → código → satisfacer → refactor. Sin steps "solo tests".

La fase de clarificación/research/design de sop-planning se omite: el diseño ya está
detallado y aprobado en el spec (brainstorming + spec-review + user gate). Este
documento es el file-structure + plan de implementación + estrategia de verificación.

## Chunk 1: File structure y pasos

### File structure (qué toca cada archivo y su responsabilidad)

| Archivo | Acción | Responsabilidad | SCEN |
|---|---|---|---|
| `components/layout/reservation-status-actions.tsx` | modificar | Contrato del botón de estado: de bloqueo (`hasUnsavedChanges`) a delegación (`onBeforeStatusChange?: () => Promise<boolean>`). Orden confirm → await callback → dispatch. | 007, 011 |
| `components/forms/reservation-form.tsx` | modificar | Orquestador: `persistReservation()` (validar+guardar sin navegar+`reset`), `handleSaveCustomer` → `boolean`, callback `onBeforeStatusChange` que persiste lo dirty y resuelve `true/false`. | 001–010, 012, 013 |
| `tests/unit/components/reservation-status-actions.test.tsx` | modificar | Tests nivel componente: prop ausente → dispatch directo; callback `false` → aborta; confirm antes del callback. | 007, 011 |
| `tests/unit/components/reservation-form.test.tsx` | modificar | Tests nivel formulario: autoguardado+orden, abort por inválido/error, no-op limpio, anti-falso-dirty, post-abort. | 001–010, 012, 013 |
| `app/(dashboard)/reservations/[id]/page.tsx` | **sin cambios** | Read-only: ya omite el prop → rama "cambio directo". | 011 |

Sin cambios en `lib/actions/*`, API, schema, auth ni motor de notificaciones.

**Acoplamiento de build:** flip del prop en el componente (Paso 1) rompería el
type-check del call-site del form hasta que el form se actualice. Por eso el Paso 1
incluye actualizar el call-site del form al nuevo prop con un callback temporal
(no-op que resuelve `true`), y el Paso 2 sustituye ese no-op por el orquestador
real. Cada paso deja el árbol compilando y verde.

### Pasos

- [ ] **Paso 1 — Componente: delegación en vez de bloqueo** | Size: S | Deps: none
  - En `ReservationStatusActions`: eliminar `hasUnsavedChanges?: boolean`; añadir
    `onBeforeStatusChange?: () => Promise<boolean>`.
  - `handleTransition`: reordenar a (1) confirmaciones existentes
    (`DANGEROUS_TARGETS` / `CONSOLIDATED_SOURCES`), luego (2)
    `if (onBeforeStatusChange) { const ok = await onBeforeStatusChange(); if (!ok) return; }`,
    luego (3) `startTransition` → `updateReservationStatus`. Quitar el bloque de
    bloqueo + aviso inline + `toast.error` de "cambios sin guardar" de #90.
  - Actualizar el call-site en `ReservationForm` al nuevo prop con un callback
    temporal `async () => true` (placeholder; Paso 2 lo reemplaza). La página de
    detalle queda intacta (omite el prop).
  - **Escenario (SCEN-011):** prop ausente → `updateReservationStatus` se llama
    directo con `(reservationId, target)`.
  - **Escenario (componente, refuerza SCEN-007):** con `onBeforeStatusChange`
    mockeado devolviendo `false`, el clic NO llama `updateReservationStatus`; con
    target peligroso, `window.confirm` se invoca ANTES que el callback.
  - **Acceptance:** `reservation-status-actions.test.tsx` verde (incluye red→green
    por mutación: invertir el orden confirm/callback rompe el assert de orden).
    `pnpm type-check` exit 0 (el call-site del form compila con el placeholder).

- [ ] **Paso 2 — Formulario: orquestador de autoguardado** | Size: M | Deps: Paso 1
  - Añadir `trigger`, `getValues`, `reset` al destructure de `useForm` (hoy no se
    extraen; `persistReservation` los necesita).
  - `handleSaveCustomer`: cambiar firma a `Promise<boolean>` — `return false` en la
    guarda inicial `if (!customerId)` (hoy `return;` → `undefined`, rompe el tipo) y
    en cada rama de error (parse, `result.error`, catch); `return true` tras el
    éxito. Mantener el `finally { setSavingCustomer(false) }`. El botón "Guardar
    cliente" (`onClick={handleSaveCustomer}`) sigue funcionando (ignora el booleano).
  - Añadir `persistReservation(): Promise<boolean>`:
    `const valid = await trigger();` si `!valid` → leer los errores **frescos** vía
    `formState.errors` (no la `errors` cerrada en el closure async, que puede estar
    stale) o llamar el camino `onInvalid` existente, escribir `root`, `return false`.
    Si válido → construir `FormData` desde `getValues()` (mismo armado que `onSubmit`:
    `Object.entries` + `if (value != null)` + `String(value)`), llamar
    `updateReservation(id, fd)`; si `{error}` → `setError("root", …)`, `return false`;
    si OK → `reset(getValues())` (limpia `dirtyFields`), `return true`. No navega.
  - Añadir `onBeforeStatusChange = async (): Promise<boolean> => { … }`:
    si el form está dirty (`Object.keys(dirtyFields).length > 0`) → `if (!(await persistReservation())) return false;`
    luego si `isCustomerDirty` → `if (!(await handleSaveCustomer())) return false;`
    `return true`. (Form primero, contacto después; ambos antes del estado.)
  - Reemplazar el placeholder del Paso 1: pasar `onBeforeStatusChange={onBeforeStatusChange}`
    solo en edición (`isEditing && id`). `onSubmit` (botón "Guardar cambios") queda
    igual: navega al listado (fuera de alcance).
  - **Escenarios (SCEN-001..006, 008, 009, 010, 012, 013):** autoguardado+orden vía
    `mock.invocationCallOrder`; abort por inválido (vaciar "Día recogida") y por
    `{error:"boom"}`; no-op con form limpio; anti-falso-dirty montaje y revert
    numérico; camino `setValue` vía checkbox "Conductor adicional"; segundo estado
    sin re-guardar (`reset`); post-abort editable + reintento.
  - **Escenario (SCEN-007):** con un campo dirty y target peligroso, cancelar el
    `window.confirm` → ni `updateReservation`, ni `updateCustomerContact`, ni
    `updateReservationStatus`.
  - **Acceptance:** `reservation-form.test.tsx` verde con red→green por mutación en
    al menos SCEN-001 (quitar el await del orden), SCEN-006 (ignorar `{error}`),
    SCEN-012 (quitar `reset`). `pnpm type-check`, `pnpm lint` limpios.

- [ ] **Paso 3 — Verificación y QA runtime** | Size: S | Deps: Paso 2
  - Gate completo vía `/verification-before-completion`: `pnpm test` (suite
    completa, sin regresiones; recordar el flake de contención CPU — no correr con
    dev server + agent-browser simultáneos), `pnpm type-check`, `pnpm lint`,
    `pnpm build`.
  - QA runtime con `/agent-browser` sobre branch Supabase de testing (gotcha:
    Radix Select no abre en jsdom pero sí en navegador real — probar el camino
    lugar-de-recogida real): editar lugar de recogida sin guardar → clic
    "Reservado" → la reserva queda con el lugar nuevo persistido **y** el estado
    cambiado en un solo clic; 0 errores de consola, 0 requests fallidos. Probar
    también: form limpio → estado dispara directo; campo inválido → estado abortado
    con error visible. Limpiar seed QA al terminar.
  - `/dogfood` exploratorio sobre el flujo de edición de reserva.

## Prerequisites
- Worktree ya creado y con el spec commiteado (`7e2bf05`).
- Para QA runtime: branch Supabase de testing + `.env.testing` copiado al worktree
  vía Write (Bash bloquea `.env*`); login QA por SQL si hace falta (ver memoria
  `reference_supabase_branch_qa_login`).

## Testing Strategy
- **Unit (oráculo):** Vitest + Testing Library. Spies sobre `updateReservation`,
  `updateReservationStatus`, `updateCustomerContact`; `sonner` y `window.confirm`
  mockeados. Presencia + `mock.invocationCallOrder` (guardado antes que estado).
- **Red-green obligatorio** por mutación en los SCEN que codifican el invariante
  nuevo (orden, abort, reset).
- **Runtime:** agent-browser + dogfood en branch de testing (Paso 3).

## Rollout Plan
- PR contra `main` con cuenta `pabloandi` (memoria `reference_gh_two_accounts_write`);
  body con Refs #153 (no Closes en fases parciales — `reference_gh_pr_edit_projects_classic_bug`).
- Sin migraciones, sin cambios de env, sin deploy especial. CI gatea
  (type-check → lint → test → build).
- **Rollback:** revertir el PR. Cambio puramente client-side en 2 componentes; el
  contrato de las server actions no cambia, así que revertir no deja schema/datos
  inconsistentes.
