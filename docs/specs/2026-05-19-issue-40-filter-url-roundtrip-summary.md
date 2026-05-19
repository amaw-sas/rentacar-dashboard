# Planning Summary — Issue #40

- **Fecha:** 2026-05-19
- **Goal:** Eliminar el round-trip RSC desperdiciado que dispara cada control de filtro del listado de reservas (síntoma: buscador ~5s intermitente), manteniendo el estado de filtros en la URL.

## Artifacts

- `docs/specs/2026-05-19-issue-40-filter-url-roundtrip-design.md` — diseño aprobado + spec-reviewed (incluye 7 observable scenarios).
- `docs/specs/2026-05-19-issue-40-filter-url-roundtrip-plan.md` — plan de 4 steps SDD, plan-reviewed (3 iteraciones → Approved).
- `docs/specs/2026-05-19-issue-40-filter-url-roundtrip-summary.md` — este documento.

(Fases de clarificación/research/re-diseño de sop-planning omitidas con autorización explícita: el diseño ya estaba aprobado en brainstorming.)

## Key Decisions

1. **Opción B** sobre A/C: eliminar el round-trip vía `window.history.replaceState` (shallow routing canónico, validado por docs Next.js vía Context7) en vez de sacar search de la URL (A, parche parcial) o server-side+paginación (C, no resuelve el cold-start y sobre-ingeniería a 205 filas).
2. **Fix sistémico**: cambiar `writeUrl` arregla los 7 controles + sort + page de una vez (una función, un hook).
3. **SDD red-first explícito**: Step 1 migra el harness del test (19 refs `replaceMock` → spy `replaceState`, arg `[0]`→`[2]`) dejando los sitios positivos en rojo; los 6 `.not.toHaveBeenCalled()` son red-blind hasta Step 2 (documentado, no enmascarado). SCEN-021 (path interno, spec #7) con evidencia roja contra guard deliberadamente roto.
4. **Follow-ups separados**: #41 (hook genérico, mismo bug) y #42 (server-side, deuda diferida) — fuera de alcance de #40.

## Complexity

- **Overall:** S (≈6 líneas de producción en una función + migración mecánica del test + 1 escenario nuevo).
- **Duration:** ~2-3 h incluyendo verificación runtime.
- **Risk:** Low-Medium. Riesgo único R1: cadencia de render `replaceState` vs `router.replace` para el guard `justWroteRef` — mitigado por SCEN-021 + SCEN-019 + verificación runtime; escalación definida si no se puede satisfacer sin tocar el guard.

## Recommended Next Steps

1. Aprobación del plan por el usuario.
2. `/scenario-driven-development` con los 7 observable scenarios como holdout set (viajan desde el spec).
3. `/verification-before-completion` antes de cualquier claim de "done" (CI: type-check → lint → test → build + runtime agent-browser/dogfood).

## Open Questions

Ninguna. R1 tiene path de escalación documentado en el plan; no bloquea el arranque.
