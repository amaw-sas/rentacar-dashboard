# Issue #144 — Desactivar el orden server-side de las columnas que reproducen el heapsort full-table

**Estado:** Diseño aprobado · **Fecha:** 2026-06-18 · **Refs:** #100, #102, #104, #113

## Problema

El listado de reservas ordena siempre `is_priority DESC, <sort.column>, id`
(`lib/queries/reservations.ts:173-176`). El único índice que presortea la clave
completa es `idx_reservations_priority_created (is_priority DESC, created_at DESC)`,
que sirve el orden **solo cuando `sort.column = created_at`**. Para cualquier otra
columna, el planner camina ese índice, lee **toda la tabla** y hace top-N heapsort.
Los índices single-column (`status`, `franchise`, `pickup_date`, `reservation_code`)
nunca se usan porque no cargan el leading key `is_priority`.

Tras #104 — que removió las 5 columnas snapshot (customer/identification/phone/
email/valor_oc) por exactamente este motivo — quedaron ordenables 6 columnas
no-default que reproducen el mismo problema. Medido en prod (`EXPLAIN ANALYZE`,
13,227 filas, evidencia del performance-review del PR de #104):

| Orden por | Índice usable | Filas leídas | Tiempo |
|---|---|---|---|
| `created_at` (default) | sí (compuesto) | 21 (corta en LIMIT) | **2.9ms** |
| `franchise` | no | 13,227 (full) | **230ms** ⚠️ |
| `category_code` | ninguno | 13,227 (full) | 61ms |
| `status` | no | 13,227 (full) | 13ms |
| `reservation_code` | no | 13,227 (full) | 13ms |
| `origen` (attribution_channel) | no | 13,227 (full) | 11ms |
| `pickup` (pickup_date) | no | 13,227 (full) | *no medido en #144* |

`franchise` a 230ms es estrictamente peor que cualquiera de las 5 columnas que #104
removió. Todas escalan lineal con el crecimiento de filas.

**Hallazgo no flagueado por el issue:** `pickup` (pickup_date) sigue ordenable hoy
(`columns.tsx` no le pone `enableSorting:false`) y reproduce el mismo heapsort
full-table — su índice single-column no carga el leading key `is_priority`. El issue
solo midió 5 de las 6 columnas afectadas.

## Decisión

**Opción 1 (desactivar), extendida a las 6 columnas** — incluyendo `pickup`.
Consistente con #104, cero índices nuevos, elimina el escalado lineal.

Justificación por columna (cada una tiene una herramienta mejor que ya existe):

| Columna | Herramienta alternativa existente |
|---|---|
| `franchise` | filtro `.eq("franchise", …)` (`reservations.ts:146`) |
| `status` | filtro `.eq("status", …)` (`reservations.ts:147`) |
| `origen` | filtro `.eq/.is("attribution_channel", …)` (`reservations.ts:163-167`) — hecho filtrable en #113 |
| `pickup` | filtro de rango `pickup_from`/`pickup_to` (`reservations.ts:158-159`) |
| `reservation_code` | trgm search (#059, `idx_reservations_search_trgm`) |
| `category_code` | trgm search / no es una dimensión que el operador ordene |

Ordenar por columnas de baja cardinalidad (franquicia/estado/origen) casi nunca es
lo que el operador quiere; filtrar lo es. Las de alta cardinalidad (código, nombre,
fecha de recogida) se localizan buscando o filtrando por rango, no ordenando.

**Rechazado — Opción 2 (indexar):** crear ~6 índices compuestos
`(is_priority desc, <col>, id)` es justo el costo de almacenamiento/escritura que
#104 declinó explícitamente. Mantener Opción 1 es la elección consistente.

`origen` se hizo ordenable a propósito en #113; esta decisión revierte esa
sub-decisión: sigue **filtrable** (que es el flujo real del operador), pero deja de
ser ordenable.

## Diseño

### Cambio 1 — `lib/reservations/list-params.ts`

`SORTABLE_COLUMNS` se reduce de 7 entradas a una sola:

```ts
export const SORTABLE_COLUMNS: Record<string, string> = {
  created_at: "created_at",
};
```

`parseSort` ya cae a `DEFAULT_SORT` para cualquier id ausente del whitelist
(la rama `if (!column …)` en `list-params.ts:128-130`) — no requiere cambio lógico.
Solo se actualiza el bloque de comentario doc de `SORTABLE_COLUMNS`
(`list-params.ts:43-53`) para referenciar #144. Esto es la mitad server-side: un
`?sort=` hand-editeado para una columna removida cae a `DEFAULT_SORT` (created_at desc).

### Cambio 2 — `app/(dashboard)/reservations/columns.tsx`

Añadir `enableSorting: false` a las 6 columnas: `pickup`, `reservation_code`,
`category_code`, `franchise`, `origen`, `status`. Actualizar el comentario de
`origen` (línea 263-264, que hoy dice "do not disable") para reflejar #144. Esto es
la mitad cliente: el header no pinta flecha y TanStack no emite `?sort=`.

### Auto-espejado (sin cambio de código)

`hooks/use-reservations-table-url-state.ts:144` valida `id in SORTABLE_COLUMNS`
dinámicamente. Reducir el whitelist hace que `parseSorting` caiga al fallback default
(PRIORITY_SORT + created_at desc) para cualquier `?sort=` de columna removida —
sin pintar flecha en un header `enableSorting:false`. No requiere editar el hook.

### Cambio 3 — tests existentes que codifican el comportamiento viejo

Reducir `SORTABLE_COLUMNS` a una entrada invierte aserciones que hoy verifican que
estas columnas eran ordenables. CI es type-check → lint → **test** → build (todo
debe pasar), así que estas DEBEN actualizarse en el mismo cambio:

- `tests/unit/reservations/list-params.test.ts`
  - `:96-105` ("maps a sortable column id to its DB column") — usa `sort=pickup:asc`
    → `pickup_date` y `sort=reservation_code:desc` → `reservation_code`. Reescribir
    para que la única columna mapeada sea `created_at` (`sort=created_at:asc` →
    `{ column: "created_at", ascending: true }`). Cubre SCEN-144-003.
  - `:116-121` ("falls back to default sort for the dropped snapshot columns") —
    extender el array de ids para incluir las 6 nuevas removidas
    (`franchise`, `status`, `origen`, `category_code`, `reservation_code`, `pickup`).
    Cubre SCEN-144-002.
  - `:123-130` (SCEN-009, "maps the origen sort key to attribution_channel") —
    borrar o invertir: `origen` ahora cae a `DEFAULT_SORT` (queda absorbido por el
    test anterior).
- `tests/unit/hooks/use-reservations-table-url-state.test.ts`
  - `:115-123` (SCEN-006, "?sort=pickup:asc maps with PRIORITY_SORT pinned") —
    cambiar la columna de prueba a `created_at` o invertir a fallback default;
    `pickup` ya no entra al sorting state. Cubre SCEN-144-004.
- `tests/unit/components/reservations-columns.test.tsx`
  - `:288-291` ("origen does not opt out of sorting") — **invertir** a
    `expect(col).toHaveProperty("enableSorting", false)`.
  - `:350-354` — corregir el comentario stale ("origen stays sortable") y extender el
    loop `:355+` ("dropped snapshot sort columns go inert") para incluir las 6 nuevas
    columnas removidas. Cubre SCEN-144-001.

Tests nuevos a añadir (encoden los SCEN de este issue):
- Guard de cardinalidad: `Object.keys(SORTABLE_COLUMNS)` === `["created_at"]` —
  pin barato contra una re-adición futura que reintroduzca silenciosamente un camino
  de heapsort. (SCEN-144-005, mitad automatizable.)

### Sin migraciones

Cero cambios de schema, cero índices. El comportamiento runtime: toda query del
listado ordena por `created_at`, servido por `idx_reservations_priority_created`.

## Escenarios observables

- **SCEN-144-001** (UI inerte): Dado el listado renderizado, al inspeccionar las
  definiciones de columna, solo `created_at` ("Creado") tiene orden habilitado;
  `pickup`, `reservation_code`, `category_code`, `franchise`, `origen`, `status`
  tienen `enableSorting:false` (no renderizan flecha ni cambian el orden al clicar).

- **SCEN-144-002** (server fallback): Dado `?sort=<col>:asc` o `:desc` con
  `col ∈ {franchise, status, origen, category_code, reservation_code, pickup}`,
  cuando corre `parseListParams`, entonces `sort === DEFAULT_SORT` (created_at desc).

- **SCEN-144-003** (retenida funciona): Dado `?sort=created_at:asc`, cuando corre
  `parseListParams`, entonces `sort === { column: "created_at", ascending: true }`.

- **SCEN-144-004** (client mirror): Dado `parseSorting` con `?sort=origen:asc`,
  entonces retorna `[PRIORITY_SORT, ...DEFAULT_USER_SORT]` (created_at desc) — no se
  pinta flecha en el header de origen.

- **SCEN-144-005** (perf — no quedan caminos lentos): `SORTABLE_COLUMNS` contiene
  exclusivamente `created_at`, que usa `idx_reservations_priority_created`. Ninguna
  columna ordenable puede disparar el top-N heapsort full-table.
  - **Automatizable:** test de cardinalidad (`Object.keys(SORTABLE_COLUMNS)` ===
    `["created_at"]`).
  - **Verificación manual/prod:** `EXPLAIN ANALYZE` del orden default sigue presorted
    y no lee las 13k filas. No es automatizable en la suite unitaria (requiere datos
    de prod) — es un paso de verificación manual, no un test.

## Criterio de satisfacción

- Las cabeceras de las 6 columnas quedan inertes (sin flecha, sin emitir `?sort=`) —
  mismo tratamiento que #104, cubierto por `parseSort`/`parseSorting` espejando el
  whitelist.
- Ningún `?sort=` de columna removida sobrevive: cae a `DEFAULT_SORT` en cliente y
  servidor.
- `created_at` sigue ordenable en ambas direcciones (no regresa).
- Cero índices nuevos; sin impacto en latencia de escritura.

## Fuera de alcance

- Indexar cualquier columna (Opción 2 rechazada).
- Tocar filtros existentes (franchise/status/origen/pickup-range siguen vivos).
- Búsqueda trgm (#102/#059, ya en prod).
