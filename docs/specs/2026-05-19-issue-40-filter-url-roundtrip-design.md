# Design — Issue #40: eliminar round-trip RSC desperdiciado en filtros del listado de reservas

- **Fecha:** 2026-05-19
- **Issue:** #40
- **Follow-ups:** #41 (hook genérico, mismo anti-patrón), #42 (server-side + paginación, deuda diferida)
- **Estado:** aprobado para spec → planning

## Problema

Operadores reportan que el buscador libre de `/reservations` tarda hasta ~5s de forma **intermitente**.

Diagnóstico (evidencia recopilada en #40): la lentitud **no es el filtrado**. Todos los controles de la barra (búsqueda, franquicia, estado, ciudad, referido, rangos de fecha, sort, page) escriben su estado en la URL vía `router.replace` en `writeUrl` (`hooks/use-reservations-table-url-state.ts:238`). Como `ReservationsPage` es un Server Component dinámico (cliente Supabase con cookies → sin cache), cada cambio de query string es cache-miss del Router Cache de Next.js → re-ejecuta el Server Component → re-corre `Promise.all([getReservations(), getReferrals(), getCities()])` + payload RSC + rehidratación. Pero el filtro es 100% client-side y `q` nunca se consume server-side: **el round-trip es trabajo desperdiciado**.

Evidencia de producción (Supabase `ilhdholjrnbycyvejsub`, read-only): 205 reservas, 174 customers, tabla 640 kB, sin índice en `created_at`. Con ese volumen el filtro client-side es sub-milisegundo: el volumen **no** explica los 5s. La latencia intermitente es varianza de cold-start (Vercel Function + pooler Supabase) sobre el round-trip inútil — patrón consistente con cold-start, no con cómputo.

## Decisión

**Opción B**: eliminar el round-trip manteniendo el estado de filtros en la URL (compartible/bookmarkable), reemplazando el primitivo de navegación por la API nativa de history.

Alternativas descartadas:

- **Opción A** (sacar search de la URL): parchea un solo input, deja 6 controles con el mismo bug latente, descarta la maquinaria deliberada de estado-en-URL y rompe links compartibles. Parche de síntoma.
- **Opción C** (server-side + paginación + índices): resuelve un problema de escala inexistente a 205 filas y **no** elimina la latencia reportada (cold-start es spin-up de función, independiente del query). Alto esfuerzo, no toca el síntoma. Diferida a #42.

Alcance confirmado con el usuario: **fix sistémico** — cambiar `writeUrl` arregla los 7 controles + sort + page de una vez (mismo blast radius, una función). No special-case solo del buscador.

### Discovery que valida la decisión

Docs oficiales Next.js (Context7 `/vercel/next.js`):

> "Next.js allows you to use the native `window.history.pushState` and `window.history.replaceState` methods to update the browser's history stack without reloading the page. These calls integrate into the Next.js Router, allowing you to sync with `usePathname` and `useSearchParams`."

Implicación: `replaceState` sincroniza `useSearchParams` → el memo `paramsKey = searchParams.toString()` recomputa → `filters` se recalcula → filtrado client-side re-renderiza, **sin fetch RSC**. No se requiere mirror de estado local. `replaceState` no apila historial = misma semántica que `router.replace` (sin regresión en botón Atrás).

## Diseño

### Componente afectado

`hooks/use-reservations-table-url-state.ts` — función `writeUrl` (líneas ~219-241). Único punto de cambio.

### Cambio

1. Reemplazar:
   ```ts
   router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
   ```
   por:
   ```ts
   if (typeof window !== "undefined") {
     window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
   }
   ```
2. Eliminar `useRouter` del import de `next/navigation` y la línea `const router = useRouter()` (queda sin uso; verificado: `router` solo se usa en `writeUrl`).
3. Quitar `router` de los deps del `useCallback` de `writeUrl`.

El guard `typeof window` es defensivo: `writeUrl` solo se invoca desde event handlers/efectos cliente, pero protege renders Strict/Concurrent.

### Data flow resultante

operador escribe/filtra → `setFilter` → (debounce 250ms solo para `search`) → `writeUrl` → `window.history.replaceState` actualiza la URL **sin navegación** → `useSearchParams` sincroniza → memo `paramsKey`/`filters` recomputa → filtrado client-side (`matchesSearch` / `data.filter`) re-renderiza la tabla. Cero fetch RSC, cero re-ejecución de `getReservations`/`getReferrals`/`getCities`.

### Invariantes preservados

- **Cambio externo (Back / nav sidebar):** Next dispara navegación real → `useSearchParams` cambia → la lógica `justWroteRef`/`lastParamsKey` cancela el debounce pendiente igual que hoy (depende de `paramsKey`, que sigue cambiando).
- **Botón Atrás:** `replaceState` no apila historial = idéntico a `router.replace`. Sin regresión.
- **Links compartidos / bookmarks:** una URL con query params sigue siendo carga server normal (no afectada; solo cambian las *actualizaciones in-page*).
- **Early-return `qs === paramsKey`:** intacto.
- **Debounce de búsqueda (250ms) y maquinaria de cancelación:** intactos.

### Boundaries

Sin cambios en: queries (`lib/queries/`), contrato de datos, modelo de TanStack, DB/migraciones, `ReservationsPage`. El cambio está contenido en la capa de sincronización URL↔estado del cliente.

## Fuera de alcance

- `hooks/use-data-table-url-state.ts:116` — mismo anti-patrón, otros listados → **#41**.
- Opción C (server-side + paginación + índices `created_at`/trigram) → **#42**, accionar cuando el volumen supere ~2-3k filas.

## Testing

- **Unit (vitest, `tests/unit/hooks/`):** mock `window.history.replaceState`; assert que `setFilter` (search y un filtro enum), `clearAll`, `onSortingChange`, `onPaginationChange` invocan `replaceState` con el href esperado y que NO se invoca navegación de router.
- **Runtime (`/agent-browser` + `/dogfood`):** en `/reservations`, escribir un término en el buscador y verificar vía Network/Server Timing que NO se dispara request al RSC del segmento, que la tabla filtra correctamente, y cero errores de consola / requests fallidos. Repetir con un filtro enum y con paginación.

## Observable scenarios

1. **Given** el listado `/reservations` cargado, **when** el operador escribe un término en el buscador, **then** la tabla filtra sin ningún request RSC al segmento `/reservations` (verificable en Network).
2. **Given** el listado cargado, **when** el operador cambia el filtro de Estado, **then** la URL refleja `?status=...` y la tabla filtra sin fetch RSC.
3. **Given** un filtro aplicado con URL `?q=foo`, **when** se comparte/abre esa URL en pestaña nueva, **then** el listado carga con el filtro aplicado (server load normal, sin regresión).
4. **Given** un término escrito y debounce pendiente, **when** el operador navega Atrás o por el sidebar, **then** el debounce se cancela y no clobberea el nuevo estado de URL (invariante actual preservado).
5. **Given** el operador aplicó varios filtros, **when** presiona el botón Atrás, **then** el comportamiento es idéntico al actual (replaceState no apila historial — sin regresión).
6. **Given** `clearAll` invocado, **when** se limpian los filtros, **then** la URL queda sin params gestionados y la tabla muestra todo, sin fetch RSC.

---
*Evidencia: lectura de código + query read-only a Supabase prod + Context7 docs Next.js. Sin cambios de código aplicados en esta fase.*
