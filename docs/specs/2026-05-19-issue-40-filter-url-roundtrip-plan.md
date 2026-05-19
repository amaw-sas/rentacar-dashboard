# Implementation Plan — Issue #40

- **Fecha:** 2026-05-19
- **Diseño (detailed-design):** `docs/specs/2026-05-19-issue-40-filter-url-roundtrip-design.md` (aprobado + spec-reviewed)
- **Branch/worktree:** `fix/issue-40-filter-url-roundtrip` @ `.worktrees/issue-40-filter-url-roundtrip`
- **Modo planning:** directo (diseño ya aprobado; fases de clarificación/research/re-diseño omitidas con autorización explícita del usuario)

## Chunk 1: Plan

### File Structure Map

| Archivo | Acción | Responsabilidad única |
|---|---|---|
| `hooks/use-reservations-table-url-state.ts` | MODIFY | Sincronización URL↔estado cliente. Cambio acotado a `writeUrl`: primitivo de navegación `router.replace` → `window.history.replaceState`; eliminar `useRouter` import, `const router`, y `router` de deps del `useCallback`. |
| `tests/unit/hooks/use-reservations-table-url-state.test.ts` | MODIFY | Migrar las **19 referencias `replaceMock`** a un spy noop de `window.history.replaceState` (arg URL `[0]`→`[2]`); retener el stub `useRouter` del mock `next/navigation` (inofensivo). Mantener verdes los ~30 escenarios SCEN-001..020 contra el nuevo contrato. Añadir SCEN-021 (path interno, spec scenario 7). Detalle completo en Step 1. |

Sin otros archivos. Sin DB/migraciones. Sin cambios en queries, `ReservationsPage`, ni modelo TanStack. `useRouter` no tiene otros consumidores en el archivo (verificado: solo línea ~160 def + ~238 uso).

### Prerequisites

- Ninguna dependencia nueva. `window.history` es API nativa del browser/jsdom; vitest ya corre en `jsdom` (`vitest.config` `environment: "jsdom"`, `setupFiles: ./tests/setup.ts`).
- Trabajar dentro del worktree `.worktrees/issue-40-filter-url-roundtrip`.

### Implementation Steps (SDD: scenario → code → satisfy → refactor)

**Step 1 — Migrar el harness de captura del test al contrato `replaceState` (red).** | Size: S | Dependencies: none

Antes de tocar producción, reescribir el mecanismo de captura del test al contrato `replaceState`. Producción aún llama `router.replace` → el subconjunto de aserciones positivas queda en **rojo** (SDD-red esperado: el nuevo contrato aún no se cumple).

**Superficie de migración completa (19 referencias a `replaceMock`):** sustituir **toda** referencia a `replaceMock` por un spy de `window.history.replaceState`. Mapeo por sitio (line numbers derivarán; el SCEN es el ancla estable):
- **Spy:** `const replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})`. **Noop deliberado** (no call-through): jsdom `replaceState` muta `window.location`; con call-through ensuciaría el estado mientras el test controla la URL vía el mock `useSearchParams`/`currentParams`. El noop mantiene `useSearchParams` como única fuente de verdad (igual que el `replaceMock` actual).
- **Helper `lastReplaceUrl()` (≈L44-48):** `replaceMock` → `replaceStateSpy`; `expect(replaceMock).toHaveBeenCalled()` → `expect(replaceStateSpy)…`; el arg de URL pasa de índice `[0]` a **`[2]`** (`replaceState(state, unused, url)`). Lo consumen los SCEN que llaman `lastReplaceUrl()` (SCEN-002/003/005/007/008/013/014/016/020…).
- **4 sitios inline fuera del helper que leen URL** vía `.mock.calls`: SCEN-013, SCEN-009, SCEN-020, SCEN-016 → `replaceStateSpy`, índice `[0]`→`[2]`. (El 5º `.mock.calls` es el `.at(-1)` del propio helper, ya cubierto arriba — no es un sitio adicional.)
- **4 sitios `toHaveBeenCalledTimes(N)`:** SCEN-013, SCEN-009, SCEN-020, SCEN-016 → `replaceStateSpy` (conteo preservado 1:1, una `replaceState` por cada `router.replace` previa).
- **6 sitios `.not.toHaveBeenCalled()`:** SCEN-011, SCEN-012, SCEN-009, SCEN-010, SCEN-019, SCEN-016 → `replaceStateSpy`.
- `replaceMock` ya no se referencia (`const` + `mockClear` en `beforeEach` se eliminan/retargetean al spy). El stub `useRouter` del mock `next/navigation` (≈L11-18) **se retiene intencionalmente** (inofensivo tras quitar `useRouter` del hook — el design testing-point (c) se refiere al *archivo del hook*, no al mock; evita un cleanup fantasma). `usePathname`/`useSearchParams` del mock siguen igual.

Nota: **SCEN-009 y SCEN-016 son mixtos** — cada uno tiene una aserción `.not.toHaveBeenCalled()` (path no-write, red-blind) Y aserciones `toHaveBeenCalledTimes`+`.mock.calls` (path write, deben ir rojo). El particionado abajo es **por sitio de aserción**, no por escenario.

- **Acceptance Step 1 (rojo discriminante explícito, por sitio):**
  - **Sitios positivos (deben ir ROJO limpio** — "replaceState no fue llamado", no error de setup/compilación): helper `lastReplaceUrl` (sirve SCEN-002/003/005/007/008/013/014…) + los 4 inline URL (SCEN-013/009/020/016) + los 4 `toHaveBeenCalledTimes` (SCEN-013/009/020/016).
  - **Sitios `.not.toHaveBeenCalled()` (6: SCEN-011, SCEN-012, SCEN-009, SCEN-010, SCEN-019, SCEN-016) permanecen VERDES por construcción** en esta fase: `replaceState` genuinamente no se llama mientras producción usa `router.replace`. Son **red-blind** aquí — NO discriminan correcto-vs-setup-roto; ganan poder discriminante transitivamente en Step 2 (cuando producción llama `replaceState` y deben seguir verdes solo en los paths sin escritura: SCEN-011 no-op `qs===paramsKey`, SCEN-012 buffer pre-debounce, SCEN-010 post-unmount, SCEN-019 cancelación externa, y los paths no-write de SCEN-009/016). Documentado para que el implementador no confunda este verde con "ya pasa".
  - `pnpm type-check` limpio.

**Step 2 — Swap del primitivo de navegación en `writeUrl` (green).** | Size: S | Dependencies: Step 1

Scenario embebido (spec #1, #2, #6): *Given `/reservations` cargado, when operador escribe término / cambia filtro enum / clearAll, then la URL se actualiza y la tabla filtra **sin request RSC** al segmento.*
- En `writeUrl`: reemplazar `router.replace(qs ? \`${pathname}?${qs}\` : pathname, { scroll: false })` por:
  ```ts
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }
  ```
- Eliminar `useRouter` del import `next/navigation`; eliminar `const router = useRouter()`; quitar `router` de los deps del `useCallback` de `writeUrl`.
- Acceptance: **todos los escenarios SCEN-001..020 verdes** contra `replaceStateSpy` — los sitios positivos (helper + 4 inline URL + 4 `toHaveBeenCalledTimes`) ahora pasan (mismo href, query serialization intacta, índice `[2]`); los 6 `.not.toHaveBeenCalled()` siguen verdes pero **ya discriminantes** (solo verde en paths sin escritura: SCEN-011 no-op `qs===paramsKey`, SCEN-012 buffer pre-debounce, SCEN-010 post-unmount, SCEN-019 cancelación externa, paths no-write de SCEN-009/016). `pnpm type-check` y `pnpm lint` limpios (sin `useRouter` huérfano en el hook). Guard `typeof window`: bajo jsdom `window` siempre definido → rama falsa (SSR no-op) **inalcanzable en test**; ningún escenario la asercia (evita un test inejecutable).

**Step 3 — Cubrir la suposición de mayor riesgo: path interno no cancela debounce (green).** | Size: S | Dependencies: Step 2

Scenario embebido (spec #7): *Given término escrito + debounce pendiente, when ocurre otra escritura interna (`setFilter` de otro filtro), then el debounce NO se cancela espuriamente — la escritura se clasifica interna tras `replaceState`.*
- Nuevo `it("SCEN-021 internal write after replaceState does not spuriously cancel pending search debounce")`: tipear en search (debounce armado) → `setFilter` síncrono de un filtro enum → avanzar timers → assert que el `q` del search **sí** termina en la URL (debounce no fue cancelado) y que el filtro enum también está. Complementa SCEN-019 (path externo ya existente).
- **Evidencia roja de SCEN-021 (red-before-green explícito):** SCEN-021 NO puede fallar contra el código pre-Step-2 (ese usa `router.replace`; SCEN-019 ya lo cubre) — no es un test verde-de-nacimiento ilegítimo. Su rojo se observa **deliberadamente rompiendo el guard** `justWroteRef`/`lastParamsKey` (p. ej. forzando `externalChange = true`) y verificando que SCEN-021 detecta la cancelación espuria; luego se restaura el guard y queda verde. Esto materializa la red-phase de la suposición de mayor riesgo R1 (ver más abajo) en vez de asumir el verde.
- Acceptance: SCEN-021 verde con guard intacto y rojo con guard roto (evidencia capturada); SCEN-019 (cancelación externa) sigue verde — ambos paths del guard cubiertos.

**Step 4 — Verificación runtime (satisfy scenarios, no solo tests).** | Size: M | Dependencies: Step 3

Scenarios embebidos (spec #1,#2,#3,#5): vía `/agent-browser` + `/dogfood` contra `pnpm dev` en el worktree.
- (1) `/reservations` → escribir término en buscador → Network/Server Timing: **NO** hay request RSC al segmento; tabla filtra correcto.
- (2) repetir con filtro enum y con paginación (incluye page-clamp effect `reservations-table.tsx:121-125`).
- (3) abrir URL `?q=foo` en pestaña nueva → carga server-side normal con filtro aplicado (no-regresión).
- (5) aplicar varios filtros → botón Atrás → comportamiento idéntico al actual (replaceState no apila).
- Acceptance: cero errores de consola, cero requests fallidos, los 4 scenarios observados pasando. Evidencia capturada (screenshots/network) antes de cualquier claim de "done".

### Testing Strategy

- **Unit:** el archivo de test migrado al spy de `replaceState`; ~30 escenarios existentes + SCEN-021. `pnpm test` single-run verde. CI gate: type-check → lint → test → build.
- **Runtime/E2E manual:** Step 4 (agent-browser + dogfood). No se añade E2E Playwright (no wired a CI; fuera de alcance).
- **Satisfacción de scenarios:** los 7 observable scenarios del spec son el holdout set. SDD: ningún código de producción sin su scenario rojo primero (Steps 1→2→3). Debilitar un scenario para que pase = reward hacking, prohibido.

### Rollout Plan

- **Deploy:** cambio puramente client-side en un hook; sin migración, sin env vars, sin feature flag. Merge a `main` → Vercel build → preview → prod por el pipeline normal (CI: type-check/lint/test/build deben pasar).
- **Monitoreo:** confirmar en prod (Server Timing / Network en `/reservations`) que escribir en el buscador no dispara fetch RSC del segmento; verificar con un operador que la latencia intermitente desapareció.
- **Rollback:** revert del único commit de producción (`git revert`). Sin estado persistente, sin migración → rollback trivial e inmediato, cero efectos colaterales.

### Riesgos / Flags

- **R1 (mayor):** cadencia de render de `replaceState` vs `router.replace` podría partir la transición de `paramsKey` y misclasificar interno/externo en el guard `justWroteRef`. Mitigado por SCEN-021 (unit, path interno) + SCEN-019 (externo) + Step 4 runtime. Si SCEN-021 no se puede poner verde sin tocar el guard → escalar: el guard asume una cadencia que `replaceState` no garantiza; reevaluar opción B-ii o ajuste del guard (no debilitar el scenario).
- **R2 (menor):** `useSearchParams` debe reflejar `replaceState` en jsdom igual que en runtime. El test mockea `useSearchParams`, así que el unit no prueba esta integración — la cubre Step 4 (runtime real). Documentado, no oculto.
