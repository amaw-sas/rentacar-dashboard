# Issue #144 — Plan de implementación

**Spec:** `2026-06-18-issue-144-disable-remaining-heapsort-sorts-design.md` (aprobado, 2 pasadas de review)
**Branch/worktree:** `task/issue-144-disable-heapsort-sorts` · `.worktrees/issue-144-disable-heapsort-sorts`
**Fecha:** 2026-06-18

Nota sobre fases de sop-planning: clarificación y research se omiten — el diseño ya
está detallado, revisado y aprobado. Este documento es solo el file map + plan de
pasos (Step 6.5–7) y su review loop (Step 7.5).

## File map (Step 6.5)

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `lib/reservations/list-params.ts` | Whitelist de orden compartido (single source of truth) | `SORTABLE_COLUMNS` → `{ created_at }`; comentario doc `:43-53` → #144 |
| `app/(dashboard)/reservations/columns.tsx` | Defs de columna TanStack (mitad cliente del whitelist) | `enableSorting:false` en 6 columnas; comentario `origen` `:263-264` → #144 |
| `tests/unit/reservations/list-params.test.ts` | Verifica `parseSort`/`parseListParams` | Reescribir mapeo positivo a `created_at`; extender loop de fallback; borrar SCEN-009 origen; añadir guard de cardinalidad |
| `tests/unit/components/reservations-columns.test.tsx` | Verifica defs de columna | Invertir test `origen`; extender loop "go inert"; corregir comentario stale |
| `tests/unit/hooks/use-reservations-table-url-state.test.ts` | Verifica `parseSorting` (espejo cliente) | SCEN-006: cambiar `pickup` → `created_at`/fallback |

Sin cambios de código en `hooks/use-reservations-table-url-state.ts` (lee
`SORTABLE_COLUMNS` dinámicamente → auto-espejado). Sin migraciones.

## Prerequisitos

- Ninguno. Sin deps nuevas, sin env, sin schema. Trabajo aislado en el worktree.

## Pasos (SDD: escenario → código → satisfacer)

### Step 1 — Reducir el whitelist server-side (S) · deps: none

Cubre **SCEN-144-002** (fallback de las 6 a DEFAULT_SORT), **SCEN-144-003**
(`created_at:asc` sigue mapeando) y la mitad automatizable de **SCEN-144-005**
(cardinalidad).

- Editar `lib/reservations/list-params.ts`: `SORTABLE_COLUMNS` = `{ created_at: "created_at" }`. Reescribir el bloque doc `:43-53` para referenciar #144 (motivo: heapsort full-table en las 6 columnas restantes; cada una con filtro/búsqueda mejor; consistente con #104).
- Editar `tests/unit/reservations/list-params.test.ts`:
  - `:96-105` ("maps a sortable column id to its DB column") → única columna mapeada `created_at`: `parse("sort=created_at:asc").sort` === `{ column: "created_at", ascending: true }`.
  - `:116-121` (loop de fallback) → extender el array de ids con `franchise, status, origen, category_code, reservation_code, pickup` (conservando los 5 del #104). Cada uno `:asc` y `:desc` → `DEFAULT_SORT`.
  - `:123-130` (SCEN-009 origen→attribution_channel) → borrar (origen queda absorbido por el loop de fallback).
  - Añadir test de cardinalidad: `expect(Object.keys(SORTABLE_COLUMNS)).toEqual(["created_at"])`.

**Acceptance:** `pnpm test tests/unit/reservations/list-params.test.ts` verde; el loop de fallback incluye las 6; existe el guard de cardinalidad.

### Step 2 — Hacer inertes las cabeceras (mitad cliente) (S) · deps: Step 1

Cubre **SCEN-144-001** (las 6 columnas opt-out de orden).

- Editar `app/(dashboard)/reservations/columns.tsx`: añadir `enableSorting: false` a las defs de `pickup`, `reservation_code`, `category_code`, `franchise`, `origen`, `status`. Actualizar el comentario de `origen` (`:263-264`, hoy "do not disable") para reflejar #144.
- Editar `tests/unit/components/reservations-columns.test.tsx`:
  - `:288-291` ("origen does not opt out") → invertir a `expect(col).toHaveProperty("enableSorting", false)`.
  - `:350-354` → corregir comentario stale ("origen stays sortable").
  - Loop "dropped snapshot sort columns go inert" (`:355+`) → extender ids con las 6 nuevas (conservando los 5 del #104).

**Acceptance:** `pnpm test tests/unit/components/reservations-columns.test.tsx` verde; las 6 columnas asertan `enableSorting:false`; `created_at` NO lo asierta (sigue ordenable).

### Step 3 — Verificar el espejo cliente del hook (S) · deps: Step 1

Cubre **SCEN-144-004** (`parseSorting` cae a fallback para columnas removidas; sin
cambio de código en el hook, solo verificación + actualización de test).

- Editar `tests/unit/hooks/use-reservations-table-url-state.test.ts`:
  - `:115-123` (SCEN-006, "?sort=pickup:asc maps with PRIORITY_SORT pinned") → cambiar la columna probada a `created_at` (sigue válida) o invertir a fallback default `[PRIORITY_SORT, ...DEFAULT_USER_SORT]`. Como pickup ya no entra al sorting state, lo correcto es: `setUrl("sort=pickup:asc")` → `result.current.sorting` === `[PRIORITY_SORT, ...DEFAULT_USER_SORT]`.
  - Paridad con el server-side: si existe un loop de ids stale (`:133-138`), extender su array para incluir `franchise, origen, status, category_code, reservation_code, pickup` — así el espejo cliente cubre las mismas 6 columnas que el fallback server.

**Acceptance:** `pnpm test tests/unit/hooks/use-reservations-table-url-state.test.ts` verde; `?sort=origen|pickup|franchise:...` resuelven al fallback default.

### Step 4 — Gate de verificación completa (S) · deps: Steps 1–3

- `pnpm type-check && pnpm lint && pnpm test && pnpm build` — todo verde (gate CI).
- QA runtime con agent-browser sobre `pnpm dev`: el listado de reservas renderiza; clicar las cabeceras franquicia/estado/origen/cat/código/recogida NO cambia el orden ni pinta flecha ni emite `?sort=`; "Creado" sí ordena. Cero errores de consola, cero requests fallidos.
- **Verificación manual SCEN-144-005 (prod):** `EXPLAIN ANALYZE` del orden default sigue presorted, no lee las 13k filas. No automatizable (datos de prod) — documentar como nota, no bloquea el merge.

**Acceptance:** suite + build verdes; QA runtime sin regresiones; nota de EXPLAIN ANALYZE registrada.

## Testing strategy

- **Unit:** vitest sobre los 3 archivos de test (list-params, columns, url-state) — encoden SCEN-144-001..004 + cardinalidad.
- **Runtime/QA:** agent-browser exploratorio sobre el listado (headers inertes, "Creado" ordena).
- **Manual/prod:** EXPLAIN ANALYZE del orden default (SCEN-144-005, mitad no automatizable).

## Rollout

- **Deploy:** estándar Vercel al merge del PR a main. Cero migraciones → nada que aplicar a Supabase, sin gate schema↔código.
- **Monitoreo:** N/A (cambio puramente de UI/whitelist; latencia del listado solo mejora — elimina caminos de heapsort).
- **Rollback:** revertir el PR. Sin estado persistente, rollback instantáneo. Un `?sort=` viejo bookmarkeado cae a DEFAULT_SORT en ambas direcciones — sin error para el usuario.
