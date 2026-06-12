# Research — Testing strategy

**Fecha:** 2026-06-12 · **Tipo:** interno. Marco del repo: Vitest 4 + `@testing-library/react` + `jsdom`; tests en `tests/unit/**` espejando `lib/` (`conventions.md`).

## Qué se testea y dónde

La estrategia A (extraer lógica a `lib/api/*-service.ts`) hace el código **testeable sin levantar servidor**. Tres niveles:

### 1. Funciones de servicio (`lib/api/availability-service.ts`, `reservation-service.ts`) — núcleo
`tests/unit/api/availability-service.test.ts`, `reservation-service.test.ts`.
- **Mock del `fetch` al proxy Railway** (respuesta de disponibilidad / creación). Patrón ya usado en el repo.
- **Mock del admin client de Supabase** con dispatch-by-table (`mockImplementation` por tabla — precedente confirmado: holdout scenarios #129, commit 1d40190 — "mockImplementation dispatch-by-table, not single fallback").
- Cubre: resolución `slug→code`, combinación fecha+hora ISO, enriquecimiento PT→ES, find-or-create sin mutar, campos requeridos, propagación de errores de negocio del proxy (`shortText`/`message`).

### 2. Serialización del estado opaco `quote` — contrato crítico
`tests/unit/api/mcp-quote.test.ts`.
- **Round-trip:** lo que `buscar_disponibilidad` emite como `quote` (referenceToken + rateQualifier + categoryCode + precios + fechas + sedes + selected_days) se deserializa **idéntico** y produce un body válido para `createReservation`.
- **Rechazo:** `quote` ausente / corrupto / alterado → `crear_solicitud_reserva` falla con error legible, NO llama al proxy.
- Encoding determinista (sin `Date.now()`/randomness en el blob).

### 3. Handlers de las herramientas MCP — borde
`tests/unit/api/mcp-tools.test.ts`.
- Invocar directamente las funciones handler registradas (`async (args, extra) => ...`) con servicios mockeados.
- Verificar forma de salida MCP: `{ content: [{ type: "text", text }] }`; errores → `isError: true`.
- `crear_solicitud_reserva` mapea `{ reserveCode, reservationStatus }` → `{ estado, numero_solicitud, mensaje }`.
- Auth: `verifyToken` acepta `x-api-key` correcto, rechaza ausente/incorrecto.

## Verificación manual (runtime)
- **MCP Inspector** (`@modelcontextprotocol/inspector`) o un cliente MCP real apuntando al endpoint Streamable HTTP local (`pnpm dev` con `.env.testing`, ver memoria `env_testing_dev_server`) → `x-api-key` de prueba → ejecutar `buscar_disponibilidad` → tomar un `quote` → `crear_solicitud_reserva` → confirmar reserva creada en la branch de testing de Supabase (NO prod).
- Cruzar con la regla del repo: branch de Supabase de testing para QA (memoria `reference_supabase_branch_qa_login`), nunca prod.

## Fuera de alcance
- E2E Playwright (existe local, no en CI — `conventions.md`). No aplica a un endpoint MCP server-to-server.
- Tests del proxy Railway (`proxy/` es paquete separado, no linteado/testeado con root).

## SDD
Cada paso del plan que introduce funcionalidad define su escenario observable ANTES del código (Iron Law). Los escenarios de las funciones de servicio + el round-trip del `quote` son los observables primarios; los tests los codifican.
