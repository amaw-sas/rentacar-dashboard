# Issue #138 — Plan de implementación: idempotencia DB-backed en el dashboard

**Fecha:** 2026-06-17
**Spec:** `docs/specs/2026-06-17-issue-138-db-idempotency-design.md`
**Branch:** `task/issue-138-db-idempotency`

Construye sobre #99 (PR #139 merged): el proxy ya deduplica la llamada a Localiza; este plan añade la guarda DB-backed en el dashboard para que un resubmit/multi-instancia no inserte fila duplicada ni notifique dos veces.

## Mapa de archivos (decisiones de descomposición)

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `supabase/migrations/<ts>_062_reservations_reservation_code_unique.sql` | **NUEVO** | Índice único parcial sobre `reservation_code` con cutoff `created_at >= '2026-01-01'`. Única autoridad cross-instancia. |
| `lib/api/reservation-service.ts` | **MOD** | Rama `23505` en el insert de `createReservation` → return temprano sin re-notificar. |
| `lib/api/resolve-references.ts` | **MOD** | `findOrCreateCustomer` find-after-conflict (captura `23505` → re-SELECT). |
| `tests/unit/api/reservation-service.test.ts` | **MOD** | SCEN-A (replay → 1 fila, 0 notif), SCEN-E (otro `23505` → 500). |
| `tests/unit/api/resolve-references.test.ts` | **MOD** | SCEN-D (cliente nuevo concurrente → id recuperado, sin escritura). |
| `docs/specs/issue-138-db-idempotency/scenarios/db-idempotency.scenarios.md` | **NUEVO** | Holdout SDD — SCEN-A…F como vocabulario único across design/plan/tests. |

**Decisión de descomposición:** un archivo por responsabilidad, sin tocar `route.ts` (el wrapper de #72 no cambia: el contrato de respuesta es idéntico en replay y en éxito). Las dos guardas (`reservation-service` y `resolve-references`) son independientes — distinto archivo, distinta constraint, distinto test — y pueden implementarse y verificarse por separado.

> **Nota sobre SCEN-B/C/F (comportamiento del índice):** son propiedades del **predicado SQL**, no del código de app, y el índice no se puede construir en jsdom. → Se verifican en la capa SQL (Step 1) sobre una branch de Supabase de testing, no con unit mocks. Los unit tests (SCEN-A/D/E) validan la **lógica de rama** (qué hace el código al recibir un `23505`); la atomicidad TOCTOU real solo es demostrable a nivel SQL/integración. No es un hueco del diseño: es la frontera entre lo que el mock puede afirmar y lo que solo Postgres puede.

## Prerequisitos

- Worktree `.worktrees/issue-138-db-idempotency` (branch `task/issue-138-db-idempotency`) — ya creado.
- Acceso MCP Supabase al proyecto `ilhdholjrnbycyvejsub` (prod) y capacidad de crear branch de testing para SCEN-B/C/F.
- Verificado en prod **antes** de empezar: 0 duplicados de `reservation_code` en la partición `created_at >= '2026-01-01'`; única UNIQUE de `customers` es `customers_identification_number_key`.

## Steps

### Fase 1 — Fundación DB

**Step 1 — Migración `062`: índice único parcial + verificación SQL (SCEN-B/C/F)**
`Size: S | Dependencias: none`

- Crear `supabase/migrations/<ts>_062_reservations_reservation_code_unique.sql`:
  ```sql
  create unique index reservations_reservation_code_unique
    on public.reservations (reservation_code)
    where reservation_code is not null
      and reservation_code <> ''
      and created_at >= '2026-01-01';
  ```
- **Escenario (SCEN-F):** Given prod con 49 pares legacy duplicados (`created_at <= 2025-12-06`), When corre `CREATE UNIQUE INDEX` con el cutoff, Then construye con éxito y **0 filas** se borran/modifican.
- **Escenario (SCEN-B):** Given el índice creado, When se insertan dos filas con `reservation_code` **distintos** y `created_at >= '2026-01-01'`, Then ambas insertan.
- **Escenario (SCEN-C):** Given el índice creado, When se insertan dos filas con `reservation_code = ''`, Then ambas insertan (el predicado excluye `''`).
- **Anti-escenario (SCEN-A a nivel SQL):** dos filas con el **mismo** `reservation_code` no vacío y `created_at >= '2026-01-01'` → la segunda falla con `23505`. **Afirmar explícitamente que el texto del error contiene `reservations_reservation_code_unique`** — así se valida contra el string real de Postgres el mismo substring que el código de app matchea en Step 2 (cierra el lazo SCEN-E).
- **Criterios de aceptación:** la migración aplica sin error sobre una **branch de Supabase de testing** sembrada con los 3 casos (mismo code, codes distintos, code vacío); las 4 aserciones SQL pasan; un `SELECT count(*)` pre/post confirma 0 filas alteradas. Documentar la corrida en el cuerpo del PR.
- **Verificación red→green:** primero confirmar que **sin** el índice la inserción de dos filas con el mismo code tiene éxito (estado actual), luego que **con** el índice falla.

### Fase 2 — Insert idempotente

**Step 2 — Rama `23505` en `createReservation` (SCEN-A, SCEN-E)**
`Size: M | Dependencias: Step 1`

- En `lib/api/reservation-service.ts`, donde hoy `if (insertError || !inserted) → ServiceError(500)`:
  - Si `insertError.code === '23505'` **y** `insertError.message.includes('reservations_reservation_code_unique')` → **return temprano** `{ reserveCode, reservationStatus: status }` y **no** ejecutar el bloque de notificaciones (email inline + `after()` WhatsApp/GHL).
  - Cualquier otro `insertError` (incluido otro `23505`) → `ServiceError(500)` como hoy.
  - **Placement:** el return va en el manejo de `insertError` (líneas 344-347), **dentro** del `try` (devuelve valor, no lanza), short-circuitando **antes** del bloque de notificaciones (354-379). El `try/catch` externo (386-390) queda intacto.
- **Escenario (SCEN-A):** Given un booking con code `K` ya insertado, When un 2º insert con el mismo `K` recibe `23505` de `reservations_reservation_code_unique`, Then `createReservation` devuelve `{reserveCode:K, status}` y **no** llama `sendReservationNotifications`, `sendStatusWhatsApp` ni `syncReservationToGhl`.
- **Escenario (SCEN-E):** Given un `23505` de **otra** constraint (mensaje sin `reservations_reservation_code_unique`), When el insert falla, Then `createReservation` lanza `ServiceError(500)` — no lo trata como replay.
- **Criterios de aceptación:** en `tests/unit/api/reservation-service.test.ts`, mockear el cliente Supabase para que `.insert().select().single()` devuelva `{ data: null, error: { code: '23505', message: '...reservation_code_unique...' } }` (SCEN-A) y `{ code: '23505', message: 'duplicate ... customers_pkey' }` (SCEN-E). Spies en las 3 funciones de notificación: 0 llamadas en SCEN-A. El mock matchea el campo **`message`** (no un `constraint` inexistente). Tests verdes; rojo verificado contra el código actual (que hoy lanza 500 en cualquier `insertError`).

### Fase 3 — Atomicidad de cliente

**Step 3 — `findOrCreateCustomer` find-after-conflict (SCEN-D)**
`Size: S | Dependencias: none`

- En `lib/api/resolve-references.ts`, en la rama de `INSERT` de `findOrCreateCustomer`:
  - Si el insert falla con `23505` en `customers_identification_number_key`, re-SELECT por `identification_number` y devolver el `id` existente **sin escribir** (respeta #25).
  - Cualquier otro error sigue lanzando como hoy.
- **Escenario (SCEN-D):** Given dos requests de cliente **nuevo** idéntico en paralelo, When uno gana el `INSERT` y el otro choca en `customers_identification_number_key`, Then el segundo recupera el `id` existente y **no** hay 500 ni segunda escritura.
- **Criterios de aceptación:** en `tests/unit/api/resolve-references.test.ts`, mockear el `INSERT` para devolver `23505` y el re-SELECT posterior para devolver el `id` ganador; afirmar que `findOrCreateCustomer` devuelve ese `id` y no relanza. Verificar que el SELECT inicial vacío + INSERT con conflicto + re-SELECT es el orden ejercido. Rojo verificado contra el código actual (throw genérico).
  - **Gotcha del mock:** el helper `createMockSupabase` actual resuelve `.limit().single()` siempre al **mismo** valor fijo (`resolve-references.test.ts:43-47`), así que no puede expresar el flujo stateful de SCEN-D (1er SELECT vacío → INSERT 23505 → 2º SELECT con winner). El implementador debe encadenar `mockResolvedValueOnce` en el spy de `single` (vacío, luego winner) o extender el helper. No asumir que el helper sirve tal cual.

## Testing Strategy

- **Unit (vitest, jsdom):** SCEN-A, SCEN-D, SCEN-E vía mocks del cliente Supabase. Cada test debe fallar primero contra el código actual.
- **SQL/integración (branch Supabase testing):** SCEN-B, SCEN-C, SCEN-F — el comportamiento real del índice parcial, que jsdom no puede ejercer.
- **Gates CI:** `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm build` exit 0.
- **Quality gate (4 agentes):** security, performance, code-reviewer, edge-case-detector tras la implementación (como en #99), vía `/pull-request`.
- **`/verification-before-completion`** obligatorio antes de cualquier commit/PR/claim de "done".

## Rollout Plan

1. **Migración a prod primero** (gatea el código al schema — memoria `feedback_prefer_automated_migrations`):
   - Aplicar vía **MCP `apply_migration`** sobre `ilhdholjrnbycyvejsub`. **Nunca `db push`** (arrastra los drops 049/051 — incidente #133).
   - Tras aplicar, renombrar el archivo local a `<timestamp>_062_<name>.sql` alineado con `schema_migrations` remoto (memoria `feedback_supabase_migration_naming`).
   - Post-verify: `SELECT` de confirmación del índice + recuento de filas sin cambios.
2. **Merge del código** (Steps 2-3) después de que el índice exista en prod. El catch del `23505` es **inerte** si el índice no existe (nunca dispara), así que el orden es seguro en ambos sentidos; si un resubmit cae en la ventana intermedia, da 500 (seguro, sin duplicado).
3. **Monitoreo:** revisar logs de `[reservation]` por aparición de la rama de replay; confirmar en prod que un resubmit real produce 1 fila + 1 notificación.
4. **Rollback:** `DROP INDEX reservations_reservation_code_unique;` (no destruye datos) + revert del código. Independientes.

## Open Questions / Follow-ups

- **Mensualidades** (`reservation_code` null): sin dedupe DB; necesitarían fingerprint. Fuera de alcance, anotado.
- **Limpieza histórico legacy** (49 pares): data-ops separado con backup/dry-run; no necesario para #138.
- **SCEN-2 / SCEN-4 de #99:** reconciliación del fantasma (Localiza) y submit-guard (repo Nuxt) — siguen abiertos en su propio scope.
