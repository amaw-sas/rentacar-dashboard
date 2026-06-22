> **[2026-06-22] SUPERSEDED by issue #172** (see `docs/specs/issue-172/decision-drop-oauth.md`): OAuth dropped, `x-api-key` removed, `/api/mcp` is now anonymous with a signed/expiring quote. Auth references below are historical.

# Planning Summary — Issue #72: MCP server de reservas

**Date:** 2026-06-12
**Goal:** Servidor MCP (Streamable HTTP, Vercel) con 2 herramientas que envuelven el flujo real de reservas Localiza del dashboard, para la capa agéntica del épico `rentacar-web#63`.

## Artifacts Created
- `discovery.md` — grounding empírico contra el código; 4 decisiones de arquitectura cerradas + topología (Railway hop único encapsulado).
- `rough-idea.md` — concepto + decisiones heredadas del discovery.
- `research/mcp-on-nextjs-vercel.md` — `mcp-handler` (Vercel) + SDK v1.29, **stateless**, `withMcpAuth`, riesgos (zod4↔SDK, maxDuration). Vía Context7.
- `research/reuse-strategy-a-vs-b.md` — decisión **A (in-process, extraer a `lib/`)**.
- `research/testing-strategy.md` — 3 niveles de tests (servicios, round-trip del quote, handlers) + QA manual con MCP Inspector contra branch testing.
- `design/detailed-design.md` — arquitectura, data flow del `quote` opaco, **mapeo availability→QuoteContext**, `CreateReservationInput`, `ServiceError`, error handling.
- `implementation/plan.md` — file map + **10 pasos SDD** + rollout/rollback. Aprobado por reviewer (2 pasadas).

## Key Decisions
1. **`mcp-handler` + servidor stateless** — el estado de cotización (`referenceToken`+`rateQualifier`+contexto) viaja como **blob opaco `quote`** en los argumentos del tool, lo retiene la IA cliente. Convierte el riesgo de "sesión frágil" en un contrato de datos explícito. Sin Redis.
2. **Reuso A (in-process)** — extraer la lógica de los route handlers a `lib/api/*-service.ts`, behavior-preserving; tanto el endpoint público como el MCP las llaman. Evita el hop Vercel→Vercel sobre un path ya lento (#100).
3. **Auth `x-api-key` Fase 1, OAuth Fase 2** — vía `withMcpAuth(verifyApiKey)`; Fase 2 = swap de `verifyToken` sin tocar tools.
4. **Solo reservas estándar** — Localiza solo cotiza estándar; el flujo mensual (sin token) queda fuera del MCP. Consistente con `QuoteContext` token-requerido.
5. **`ServiceError` tipado** — preserva el contrato `{error,status}` exacto de `/api/reservations*` (incl. passthrough estructurado del proxy) que consumen **los dos funnels activos (`rentacar-web` + `rentacar-reservas`)** — doble blast radius.

## Complexity Estimate
- **Overall:** L (10 pasos, mayoría S/M; el riesgo concentrado en la extracción del path de reservas y el spike zod).
- **Duration:** ~2-3 días de implementación enfocada.
- **Risk Level:** Medium — mitigado: extracción behavior-preserving gated por tests existentes; spike zod temprano; maxDuration medido en Step 8.

## Recommended Next Steps
1. Crear worktree `.worktrees/issue-72-mcp-reservas` (regla permanente: aislar antes de codear).
2. `sop-task-generator` → convertir los 10 pasos en `.code-task.md`, o ejecutar directo con `scenario-driven-development` paso a paso.
3. Ejecutar Step 1 (spike + deps) PRIMERO — desbloquea el riesgo zod4↔SDK antes de invertir en las tools.

## Resolved during planning (eran open questions)
- **Mapeo de precios `total_price`/`total_price_to_pay` ✅ CERRADO** — se leyó el código de los dos funnels (`rentacar-web` + `rentacar-reservas`); **convergen, mapeo idéntico**. Fórmulas confirmadas (sin seguro total): `total_price = totalAmount + returnFeeAmount + taxFeeAmount`, `total_price_to_pay = estimatedTotalAmount`, resto directo. Ver diseño §5.
- **Seguro total ✅ DECIDIDO** — fuera de Fase 1 (caso dominante sin seguro total; seguro total = Fase 2, evita el quirk del IVA 19% hardcoded).
- **`selected_days` ✅ ACLARADO** — los funnels lo computan por diff de fechas (regla >4h suma día), NO de `numberDays`; el MCP replica esa regla.

## Open Questions (deferred to implementation)
- **`maxDuration`**: confirmar el límite del plan Vercel (team `info-42181061`) vs peor caso ~2min (#100) en Step 8.
- **Modelo de precio client-trusted**: el dashboard no valida precios (proxy passthrough); el MCP hereda el mismo modelo que los funnels. Documentado, no bloquea #72.
- **Fase 2**: OAuth, seguro total, y herramientas futuras (`consultar_estado`, `cancelar`) fuera de alcance.
