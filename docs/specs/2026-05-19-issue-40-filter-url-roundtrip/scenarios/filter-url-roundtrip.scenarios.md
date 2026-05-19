---
name: filter-url-roundtrip
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-19T16:00:00Z
spec: docs/specs/2026-05-19-issue-40-filter-url-roundtrip-design.md
plan: docs/specs/2026-05-19-issue-40-filter-url-roundtrip-plan.md
issue: 40
---

# Scenarios — Eliminar round-trip RSC desperdiciado en filtros del listado de reservas

Holdout contract para issue #40. Write-once tras el primer commit.
Espeja la sección "Observable scenarios" del design spec.

El hook `useReservationsTableUrlState` (`hooks/use-reservations-table-url-state.ts`) cambia su
primitivo de navegación en `writeUrl` de `router.replace` a `window.history.replaceState`.
La evidencia unit referencia un spy `replaceStateSpy = vi.spyOn(window.history, "replaceState")`
y la URL en el arg index `[2]` (`replaceState(state, unused, url)`). El stub `useRouter` del
mock `next/navigation` se retiene (inofensivo). Tras el cambio, escribir/filtrar NO debe
disparar un fetch RSC del segmento `/reservations` (no se re-ejecuta
`getReservations`/`getReferrals`/`getCities`).

---

## SCEN-001: escribir en el buscador filtra sin round-trip RSC

**Given**: el listado `/reservations` cargado con N reservas, ningún filtro aplicado.
**When**: el operador escribe `lopez` en el campo "Buscador" y transcurre el debounce (250 ms).
**Then**: la tabla muestra solo las filas cuyo cliente/código matchea `lopez`; la URL refleja `?q=lopez`; NO se dispara ningún request RSC al segmento `/reservations` (las queries server-side `getReservations`/`getReferrals`/`getCities` no se re-ejecutan).
**Evidence**: (unit) vitest con `replaceStateSpy` — `setFilter("search","lopez")`, avanzar timers, parsear `replaceStateSpy.mock.calls.at(-1)?.[2]` con `URLSearchParams`, assert `params.get("q")==="lopez"`. (runtime) `/agent-browser` en `/reservations`: tipear en el buscador, panel Network/Server Timing muestra cero requests RSC al segmento mientras la tabla filtra.

---

## SCEN-002: cambiar un filtro enum actualiza URL y filtra sin fetch RSC

**Given**: el listado `/reservations` cargado.
**When**: el operador selecciona Estado = `pendiente`.
**Then**: la URL refleja `?status=pendiente`; la tabla muestra solo reservas en ese estado; sin fetch RSC del segmento.
**Evidence**: (unit) vitest — `setFilter("status","pendiente")`, `replaceStateSpy.mock.calls.at(-1)?.[2]` → `params.get("status")==="pendiente"`; `replaceStateSpy` invocado, ningún método de `useRouter()` invocado. (runtime) Network sin request RSC al cambiar el Select.

---

## SCEN-003: URL compartida con filtro carga server-side normal (no-regresión)

**Given**: un operador comparte la URL `/reservations?q=foo&status=reservado`.
**When**: otro operador la abre en una pestaña nueva (navegación real, no in-page).
**Then**: el listado carga con `filters.search==="foo"` y `filters.status==="reservado"` aplicados, vía carga server-side normal (este path SÍ ejecuta las queries server — es la carga inicial, no una actualización in-page). Comportamiento idéntico al actual.
**Evidence**: (unit) vitest monta el hook con `useSearchParams` mockeado devolviendo `q=foo&status=reservado`; assert `filters.search==="foo"`, `filters.status==="reservado"`, `searchInput==="foo"`. (runtime) abrir la URL en pestaña nueva: tabla pre-filtrada al render, sin pantalla intermedia.

---

## SCEN-004: cambio externo de URL cancela el debounce pendiente (invariante preservado)

**Given**: el operador está tipeando en el buscador (timer de debounce agendado, 250 ms sin transcurrir).
**When**: la URL cambia **externamente** — botón Atrás del browser, click en sidebar, o "Limpiar filtros".
**Then**: el timer de debounce pendiente se cancela antes de disparar; el estado de URL externo se preserva; el tipeo en vuelo se descarta junto con el cambio que el operador pidió explícitamente.
**Evidence**: (unit) vitest fake timers — `setFilter("search","abc")`, cambiar la URL externamente vía `setUrl`+`rerender`, avanzar timers >250 ms, assert que `replaceStateSpy` NO fue llamado desde el path del debounce (la `q` descartada no llega a la URL).

---

## SCEN-005: botón Atrás idéntico al comportamiento actual (replaceState no apila)

**Given**: el operador aplicó varios filtros en sucesión (cada uno actualizó la URL in-page).
**When**: presiona el botón Atrás del navegador.
**Then**: el comportamiento es idéntico al previo al cambio — `replaceState` no apila entradas de historial (igual que `router.replace`), así que Atrás no recorre estados intermedios de filtro; sin regresión.
**Evidence**: (unit) verificar que `writeUrl` usa `replaceState` (no `pushState`) — `replaceStateSpy` invocado, no existe spy de `pushState` con llamadas. (runtime) aplicar 3 filtros, presionar Atrás: el navegador sale de `/reservations` o vuelve al estado previo a entrar, NO desanda filtro-por-filtro (idéntico a baseline pre-cambio).

---

## SCEN-006: clearAll limpia la URL y muestra todo, sin fetch RSC

**Given**: el listado con varios filtros aplicados (`?franchise=...&status=...&q=...`).
**When**: el operador presiona "Limpiar filtros" (`clearAll`).
**Then**: la URL queda sin ninguno de los params gestionados; la tabla muestra todas las filas; sin fetch RSC del segmento.
**Evidence**: (unit) vitest — aplicar filtros, `clearAll()`, `replaceStateSpy.mock.calls.at(-1)?.[2]`: `URLSearchParams` sin `franchise`/`status`/`city`/`referral`/`q`/`sort`/`page`; debounce pendiente cancelado. (runtime) Network sin request RSC al limpiar.

---

## SCEN-007: escritura interna tras replaceState NO cancela el debounce espuriamente (suposición de mayor riesgo)

**Given**: el operador tipeó en el buscador (timer de debounce agendado, 250 ms sin transcurrir).
**When**: ocurre otra escritura **interna** — el operador cambia un filtro enum (`setFilter` síncrono) que llama `writeUrl`→`replaceState` mientras el debounce sigue pendiente.
**Then**: el debounce NO se cancela; ambos terminan en la URL — la `q` tipeada Y el filtro enum. La escritura interna se clasifica como interna (no externa) tras el `replaceState`, preservando el guard `justWroteRef`/`lastParamsKey`. Esto cubre el riesgo R1: que la cadencia de render de `replaceState` difiera de `router.replace` y misclasifique la transición de `paramsKey`.
**Evidence**: (unit) vitest fake timers — `setFilter("search","abc")` (debounce armado), luego `setFilter("status","pendiente")` síncrono, avanzar timers >250 ms, assert que la URL final (`replaceStateSpy.mock.calls.at(-1)?.[2]`) tiene `params.get("q")==="abc"` Y `params.get("status")==="pendiente"`. Evidencia roja capturada: con el guard deliberadamente roto (forzar `externalChange=true`) este escenario falla (la `q` se pierde); con el guard intacto pasa. Complementa SCEN-004 (path externo).
