---
name: disable-remaining-heapsort-sorts
created_by: brainstorming
created_at: 2026-06-18T00:00:00Z
---

# Issue #144 — Desactivar el orden server-side de las columnas que reproducen el heapsort full-table

Follow-up de #104. El listado de reservas ordena `is_priority DESC, <sort.column>, id`.
El único índice que presortea la clave completa es
`idx_reservations_priority_created (is_priority DESC, created_at DESC)`, que sirve el
orden solo cuando `sort.column = created_at`. Para cualquier otra columna el planner
lee toda la tabla y hace top-N heapsort (`franchise` 230ms @ 13k filas, escala lineal).

Tras #104 quedaron ordenables 6 columnas no-default que reproducen el problema:
`franchise`, `status`, `origen`, `category_code`, `reservation_code` y `pickup` (esta
última no flagueada por el issue pero afectada por la misma causa). Decisión de producto
(operador-aprobada): desactivar las 6 — consistente con #104, cero índices nuevos. Cada
columna tiene una herramienta mejor que ya existe (filtro `.eq` / rango de fechas / trgm
search). Solo `created_at` queda ordenable.

## Scenarios

### SCEN-144-001 — Las 6 cabeceras quedan inertes
- **Given** las definiciones de columna del listado de reservas (`columns.tsx`)
- **When** se inspecciona cada columna no-default
- **Then** `pickup`, `reservation_code`, `category_code`, `franchise`, `origen` y `status` tienen `enableSorting: false`
- **And** `created_at` ("Creado") NO tiene `enableSorting: false` (sigue ordenable)
- **Evidence**: `tests/unit/components/reservations-columns.test.tsx` — aserciones `toHaveProperty("enableSorting", false)` sobre las 6 columnas; ausencia sobre `created_at`

### SCEN-144-002 — Un `?sort=` de columna removida cae a DEFAULT_SORT (servidor)
- **Given** una URL con `sort=<col>:asc` o `sort=<col>:desc` con `col` ∈ {`franchise`, `status`, `origen`, `category_code`, `reservation_code`, `pickup`}
- **When** corre `parseListParams`
- **Then** `params.sort` === `DEFAULT_SORT` (`{ column: "created_at", ascending: false }`)
- **Evidence**: `tests/unit/reservations/list-params.test.ts` — loop sobre las 6 (y las 5 del #104) asertando `DEFAULT_SORT` en ambas direcciones

### SCEN-144-003 — `created_at` (la única retenida) sigue mapeando en ambas direcciones
- **Given** una URL con `sort=created_at:asc`
- **When** corre `parseListParams`
- **Then** `params.sort` === `{ column: "created_at", ascending: true }`
- **Evidence**: `tests/unit/reservations/list-params.test.ts` — aserción positiva de mapeo

### SCEN-144-004 — El espejo cliente cae al fallback default (sin flecha)
- **Given** una URL con `sort=pickup:asc` (o cualquiera de las 6 removidas)
- **When** corre `parseSorting` del hook `useReservationsTableUrlState`
- **Then** `sorting` === `[PRIORITY_SORT, ...DEFAULT_USER_SORT]` (no entra al sorting state; no se pinta flecha en el header)
- **And** el hook no requiere cambio de código (lee `SORTABLE_COLUMNS` dinámicamente)
- **Evidence**: `tests/unit/hooks/use-reservations-table-url-state.test.ts` — aserción de fallback para columnas removidas

### SCEN-144-005 — No queda ninguna columna ordenable capaz de disparar heapsort full-table
- **Given** el whitelist compartido `SORTABLE_COLUMNS`
- **When** se enumeran sus claves
- **Then** `Object.keys(SORTABLE_COLUMNS)` === `["created_at"]` — única columna ordenable, servida por `idx_reservations_priority_created`
- **And** (verificación manual/prod, no automatizable) `EXPLAIN ANALYZE` del orden default sigue presorted y no lee las 13k filas
- **Evidence**: `tests/unit/reservations/list-params.test.ts` — guard de cardinalidad; nota manual de EXPLAIN ANALYZE en el gate de verificación
