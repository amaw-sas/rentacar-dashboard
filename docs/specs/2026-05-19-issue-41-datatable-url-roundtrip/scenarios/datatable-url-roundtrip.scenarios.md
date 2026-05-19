---
name: datatable-url-roundtrip
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-19T20:30:00Z
spec: docs/specs/2026-05-19-issue-41-datatable-url-roundtrip-design.md
issue: 41
precedent: 40
---

# Scenarios — eliminar round-trip RSC desperdiciado en el hook genérico `<DataTable>`

Holdout contract para issue #41 (sibling de #40, fix idéntico ya probado). Write-once tras el primer commit. Espeja la sección "Observable scenarios" del design.

`hooks/use-data-table-url-state.ts` cambia `writeUrl` de `router.replace` a `window.history.replaceState` (+ elimina `useRouter`). Es más simple que el hook de #40: sin guard `justWroteRef`/`lastParamsKey`, sin cancelación de debounce por nav externa, sin `clearAll`/enums → R1 N/A. Evidencia unit referencia `replaceStateSpy = vi.spyOn(window.history,"replaceState")`, URL en arg `[2]`. 9 listings consumen `<DataTable>`; runtime muestrea 2.

---

## SCEN-001: escribir en el buscador filtra sin round-trip RSC

**Given**: un listing con `<DataTable>` y `searchColumn` (p.ej. `/customers`) cargado, sin filtros.
**When**: el operador escribe un término en el buscador — ruta `onColumnFiltersChange → setSearchInput → writeUrl` debounced (250ms), el path dominante y el más expuesto al shift de arg `[0]→[2]`.
**Then**: la URL gana `?q=<término>`, la tabla filtra a las filas que matchean, y NO se dispara request RSC al segmento.
**Evidence**: (unit) vitest con `replaceStateSpy` — disparar el path de búsqueda, avanzar timers, parsear `replaceStateSpy.mock.calls.at(-1)?.[2]` con `URLSearchParams`, assert `params.get("q")` correcto; `replaceStateSpy` invocado, ningún método de `useRouter()` invocado. (runtime) `/agent-browser` HAR en `/customers`: tipear en buscador → Network sin requests RSC al segmento mientras la tabla filtra.

---

## SCEN-002: cambiar el orden (sort) sin fetch RSC

**Given**: un listing con `<DataTable>` cargado.
**When**: el operador cambia el orden de una columna sortable.
**Then**: la URL gana `?sort=col:dir`, el orden de filas cambia visiblemente (indicador de sort presente), sin fetch RSC.
**Evidence**: (unit) `onSortingChange` → `replaceStateSpy.mock.calls.at(-1)?.[2]` contiene `sort=...`; resetea `page`. (runtime) clic en header sortable en el listing muestra: URL `?sort=`, orden cambiado, cero RSC.

---

## SCEN-003: paginar sin fetch RSC

**Given**: un listing con suficientes filas para >1 página.
**When**: el operador avanza de página.
**Then**: la URL gana `?page=N`, la tabla muestra esa página, sin fetch RSC.
**Evidence**: (unit) `onPaginationChange` → `replaceStateSpy` arg `[2]` con `page=N`, preserva `q`/`sort`. (runtime) paginar en un listing con data suficiente → URL `?page=`, página distinta, cero RSC. (Si el muestreo no tiene >1 página de seed, ejercitar el clamp path equivalente como en #40 SCEN-C.)

---

## SCEN-004: URL compartida hidrata q+sort+page (no-regresión)

**Given**: una URL `/<listing>?q=foo&sort=x:asc&page=2` compartida.
**When**: se abre en pestaña nueva (navegación real, no in-page).
**Then**: el listing hidrata con `q=foo`, `sort=x:asc`, `page=2` aplicados, vía carga server-side normal (este path SÍ ejecuta server — es la carga inicial). Comportamiento idéntico al previo al cambio.
**Evidence**: (unit) montar el hook con `useSearchParams` mockeado devolviendo esa query; assert `columnFilters`/`sorting`/`pagination` y `searchInput` hidratados. (runtime) abrir la URL en pestaña nueva: tabla pre-filtrada/ordenada/paginada al render.

---

## SCEN-005: botón Atrás idéntico al comportamiento actual (replaceState no apila)

**Given**: el operador aplicó q/sort/page en sucesión in-page.
**When**: presiona Atrás del navegador.
**Then**: comportamiento idéntico al previo al cambio — `replaceState` no apila historial (igual que `router.replace`), Atrás no desanda cambio-por-cambio; sin regresión.
**Evidence**: (unit) verificar que `writeUrl` usa `replaceState` (no `pushState`) — `replaceStateSpy` invocado, sin spy de `pushState` con llamadas. (runtime) aplicar 3 cambios, Atrás: navegador sale del listing o vuelve al estado previo a entrar, NO desanda uno-por-uno (idéntico a baseline pre-cambio).

---

(Sin escenarios de cancelación interno/externo de debounce: el hook genérico no implementa esa lógica — fuera de alcance, no es regresión. R1 de #40 N/A.)
