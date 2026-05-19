# Design — Issue #41: eliminar round-trip RSC desperdiciado en el hook genérico `<DataTable>`

- **Fecha:** 2026-05-19
- **Issue:** #41 (sibling de #40, mismo anti-patrón)
- **Precedente:** #40 / PR #43 (merged a5c629b) — fix idéntico, validado empíricamente
- **Estado:** aprobado para spec → SDD

## Problema

Mismo anti-patrón que #40 en el hook genérico `hooks/use-data-table-url-state.ts:116`: `writeUrl` usa `router.replace(url,{scroll:false})`, lo que en una page Server Component dinámica dispara un round-trip RSC desperdiciado (re-render + re-fetch) por cada escritura asentada de `q`/`sort`/`page`, aunque el filtrado/orden/paginación sean client-side. Afecta a **9 listings** vía `components/data-table/data-table.tsx`: customers, rental-companies, cities, locations, referrals, franchises, commissions, commissions/imports, categories.

## Decisión

Opción B idéntica a #40 (no se re-litiga A/C — decididas y descartadas en #40, fix B probado con evidencia runtime HAR + router real). En `writeUrl`:

```ts
// antes
router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
// después
if (typeof window !== "undefined") {
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
}
```

Eliminar `useRouter` del import `next/navigation`, `const router = useRouter()`, y `router` del dep array del `useCallback` de `writeUrl`.

## Delta vs #40 (reduce alcance y riesgo)

El hook genérico es **más simple** que `use-reservations-table-url-state`:

- **NO** tiene el guard render-body `justWroteRef`/`lastParamsKey` (clasificación interno vs externo).
- **NO** cancela el debounce por navegación externa (solo por nueva tecla o unmount/pathname-change).
- **NO** tiene `clearAll` ni filtros enum/date; solo `q`/`sort`/`page`.

Consecuencia: **R1 (la suposición de mayor riesgo en #40 — cadencia de render de `replaceState` vs `router.replace` afectando el guard) NO APLICA aquí** porque no existe tal guard. El cambio es un swap puro del primitivo de navegación. `useSearchParams()` reactivo a `replaceState` ya está empíricamente confirmado en #40 (no se re-verifica el mecanismo; sí el comportamiento observable de #41).

## Invariantes preservados

- **Early-return `qs === paramsKey` (`use-data-table-url-state.ts:115`) intacto:** la migración cambia solo la línea 116; el early-return que lo precede no se toca. Sostiene SCEN-017 (no-op cuando el target == URL actual) y SCEN-019 (evita el feedback loop con `autoResetPageIndex`) — tras la migración estos asertan `replaceStateSpy NOT called`.
- **Botón Atrás:** `replaceState` no apila historial = idéntico a `router.replace`. Sin regresión.

## Boundaries

Sin cambios en queries, contratos, modelo TanStack, DB, ni en las 9 pages consumidoras. Contenido en la capa de sincronización URL↔estado cliente del hook genérico.

## Aprendizaje de #40 aplicado proactivamente

La migración del test introduce el mismo `vi.spyOn(window.history,"replaceState")` module-level. En #40 esto, sin restaurar, contaminó cross-file y flakeó `customers.test.ts` bajo contención CPU (memoria `flake_customers_test_cpu_contention`). **#41 añade `afterAll(() => replaceStateSpy.mockRestore())`** en el test para prevenir la recurrencia desde el inicio.

## Testing

- **Unit:** migrar `tests/unit/hooks/use-data-table-url-state.test.ts` de `replaceMock` (`vi.fn()`) a `replaceStateSpy = vi.spyOn(window.history,"replaceState").mockImplementation(()=>{})`; URL arg `[0]`→`[2]`; retener stub `useRouter` del mock `next/navigation`; `replaceMock.mockClear()`→spy; `+ afterAll(() => replaceStateSpy.mockRestore())`. **Superficie real: 42 bloques `it`, SCEN-001..019 + grupos de setters/buffer/serialización** — toda referencia a `replaceMock`/`lastReplaceUrl()` migra. Atención especial a SCEN-016 (badge-click pre-debounce), SCEN-017 (no-op early-return → `NOT called`), SCEN-019 (feedback loop autoReset → `NOT called`): son las negativas que dependen del early-return preservado. Los 42 verdes contra el nuevo contrato. **Suite completa** verde (no solo el archivo) para descartar regresión cross-file (lección #40).
- **Runtime (`/agent-browser` + HAR):** muestrear 2 listings representativos — `customers` (searchColumn → q+sort+page) y uno sort/page-only (p.ej. `cities`). Confirmar cero requests RSC al segmento durante search/sort/page in-page; tabla refleja el cambio; cero errores consola. Muestreo (no los 9) es el default razonable para un cambio de hook compartido con consumidores homogéneos.

## Observable scenarios

1. **Given** un listing con `<DataTable>` (p.ej. `/customers`) cargado, **when** el operador escribe en el buscador — que enruta vía `onColumnFiltersChange → setSearchInput → writeUrl` debounced (path dominante del hook, el más expuesto al shift de arg `[0]→[2]`) —, **then** la URL gana `?q=...`, la tabla filtra, y NO hay request RSC al segmento.
2. **Given** un listing cargado, **when** el operador cambia el orden de una columna (sort), **then** la URL gana `?sort=col:dir`, el orden cambia visiblemente, sin fetch RSC.
3. **Given** un listing con varias páginas, **when** el operador pagina, **then** la URL gana `?page=N`, la tabla muestra esa página, sin fetch RSC.
4. **Given** una URL `?q=foo&sort=x:asc&page=2` compartida, **when** se abre en pestaña nueva, **then** el listing hidrata q+sort+page aplicados (carga server-side normal — no-regresión).
5. **Given** filtros aplicados in-page, **when** el operador presiona Atrás, **then** comportamiento idéntico al actual (`replaceState` no apila historial — sin regresión).

(Sin escenarios de cancelación interno/externo de debounce: el hook genérico no implementa esa lógica — fuera de alcance, no es regresión.)

---
*Diseño heredado de #40 (validado empíricamente). Complejidad real ya resuelta en #40; #41 es el port a un hook más simple.*
