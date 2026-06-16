# Implementation Plan — Issue #72: MCP server de reservas

**Fecha:** 2026-06-12 · **Diseño:** [../design/detailed-design.md](../design/detailed-design.md)

---

## Chunk 1: File structure + steps

### File structure map

| Archivo | Nuevo/Mod | Responsabilidad única |
|---|---|---|
| `app/api/mcp/[transport]/route.ts` | **Nuevo** | Endpoint Streamable HTTP: `createMcpHandler` + `withMcpAuth`, registra las 2 tools, exporta GET/POST. `runtime="nodejs"`, `basePath="/api/mcp"`, `maxDuration=120`. Solo wiring. |
| `lib/api/mcp/auth.ts` | **Nuevo** | `verifyApiKey(req): AuthInfo \| undefined` — valida `x-api-key` vs `MCP_API_KEY`. Punto de swap a OAuth (Fase 2). |
| `lib/api/mcp/quote.ts` | **Nuevo** | `encodeQuote`/`decodeQuote` + zod `QuoteContext`. Serialización determinista del contexto de cotización opaco. |
| `lib/api/mcp/tools.ts` | **Nuevo** | Define las 2 tools (inputSchema zod + handlers). Orquesta directory + services, da forma a salida MCP, mapea errores a `isError`. |
| `lib/api/availability-service.ts` | **Nuevo (extracción)** | `searchAvailability(input)` — núcleo de `availability/route.ts` (proxy fetch + enriquecimiento PT→ES). |
| `lib/api/reservation-service.ts` | **Nuevo (extracción)** | `createReservation(input: CreateReservationInput)` — núcleo de `reservations/route.ts` (refs + find-or-create + proxy + insert + notificaciones). Lanza `ServiceError`. |
| `lib/api/service-error.ts` | **Nuevo** | `ServiceError(status, payload)` — transporta status + payload para preservar el contrato `{error,status}` de los handlers públicos y el passthrough estructurado del proxy. |
| `app/api/reservations/availability/route.ts` | **Mod** | Pasa a `auth → parse → searchAvailability`. Contrato sin cambios. |
| `app/api/reservations/route.ts` | **Mod** | Pasa a `auth → parse → createReservation`. Contrato sin cambios. |
| `docs/apidog-rentacar-api.json` | **Mod** | Completar `AvailabilityResponseItem` + documentar endpoint MCP. |
| `.env.local.example`, `.env.staging.example` | **Mod** | Añadir `MCP_API_KEY`. |
| `middleware.ts` | **Mod** | Añadir `/api/mcp` a `PUBLIC_API_PREFIXES`. |
| `tests/unit/api/*.test.ts` | **Nuevo** | Tests por componente (ver cada paso). |

Boundary: `lib/api/mcp/` agrupa lo específico de MCP (auth, quote, tools); `lib/api/*-service.ts` es lógica de negocio compartida con los handlers públicos. Files que cambian juntos viven juntos.

### Steps

| # | Paso | Size | Deps |
|---|---|---|---|
| 1 | Spike + deps MCP | S | none |
| 2 | Extraer `availability-service` (behavior-preserving) | M | none |
| 3 | Extraer `reservation-service` + `ServiceError` + `CreateReservationInput` | M | none |
| 4 | Quote codec | S | none |
| 5 | MCP auth + prefijo middleware | S | none |
| 6 | Tool `buscar_disponibilidad` + mapeo del quote | M | 2, 4 |
| 7 | Tool `crear_solicitud_reserva` | M | 3, 4 |
| 8 | Wire route handler MCP end-to-end | S | 1, 5, 6, 7 |
| 9 | Completar OpenAPI | S | 2 |
| 10 | Env templates + runbook conector | S | 5, 8 |

---

## Chunk 2: Prerequisites & detailed steps

### Prerequisites
- `pnpm add mcp-handler @modelcontextprotocol/sdk` (deps directas; el SDK hoy es solo transitivo de `shadcn`).
- MCP Inspector para QA: `npx @modelcontextprotocol/inspector`.
- Branch de testing de Supabase + `.env.testing` (memoria `env_testing_dev_server`, `reference_supabase_branch_qa_login`). Nunca prod.
- `MCP_API_KEY` de prueba en `.env.testing`.
- **Worktree** `.worktrees/issue-72-mcp-reservas` (regla permanente: aislar antes de codear).

### Implementation steps (SDD: escenario → código → satisfacer → refactor)

**Step 1 — Spike + deps MCP** · S · deps: none
Añadir `mcp-handler` + `@modelcontextprotocol/sdk` como deps directas. Stand up un `app/api/mcp/[transport]/route.ts` mínimo con una tool `echo` para **eliminar el riesgo zod 4 ↔ SDK**.
- *Escenario:* Un cliente MCP (Inspector) conecta al endpoint local → lista la tool `echo` → la ejecuta con `{message}` → recibe el eco. `registerTool` acepta esquemas **zod 4** sin choque de peer-deps.
- *Acceptance:* Inspector lista y ejecuta `echo`; `pnpm type-check` y `pnpm build` verdes. **Verificar la versión resuelta:** `pnpm why @modelcontextprotocol/sdk` confirma una sola versión deduplicada que `mcp-handler` acepta (hoy v1.29.0 es transitiva de `shadcn`; un peer-dep distinto podría duplicar). Si zod 4 choca o hay doble versión del SDK: documentar fix (aislar/pinnear) ANTES de continuar.

**Step 2 — Extraer `availability-service`** · M · deps: none
Mover el núcleo de `availability/route.ts` (post auth+parse) a `lib/api/availability-service.ts` `searchAvailability(input)`. El handler delega.
- *Escenario:* Dado el mismo body, `POST /api/reservations/availability` devuelve una respuesta **idéntica** a la actual (mismas categorías, ES, mismos campos, mismos errores de negocio). `searchAvailability` resuelve fechas ISO y enriquece PT→ES.
- *Acceptance:* Tests existentes del endpoint verdes (contrato intacto) + nuevos unit de `searchAvailability` (proxy `fetch` mockeado, enriquecimiento, propagación de error de negocio).

**Step 3 — Extraer `reservation-service` + `ServiceError`** · M · deps: none
Crear `lib/api/service-error.ts` (`ServiceError(status, payload)`). Definir la interfaz `CreateReservationInput` (ver diseño §5). Mover el núcleo de `reservations/route.ts` (post auth+parse) a `lib/api/reservation-service.ts` `createReservation(input: CreateReservationInput)`. **Cada `return NextResponse.json(payload,{status})` interno del flujo pasa a `throw new ServiceError(status, payload)`** — incluido el passthrough estructurado del proxy (`route.ts:234-245`, preservar `{error,message,shortText}` completo). El handler delega: `try { return NextResponse.json(await createReservation(input)) } catch(e){ if(e instanceof ServiceError) return NextResponse.json(e.payload,{status:e.status}); throw e }`.
- *Escenario:* Dado el mismo body, `POST /api/reservations` produce **respuestas byte-idénticas** a las actuales en happy path **y en todos los paths de error** (sede no encontrada 400, token/qualifier faltante 400, config 500, passthrough estructurado del proxy con su status, 502 genérico). Comportamiento intacto: find-or-create sin mutar, snapshot, proxy con token+qualifier, insert, notificaciones email inline + WATI/GHL en `after()`, status mapeado, `booking_type`/`notification_required` desde `total_insurance`/extras.
- *Acceptance:* Tests existentes del endpoint verdes (contrato happy + error intacto) + nuevos unit de `createReservation` (admin client mockeado dispatch-by-table, proxy mockeado): customer no-mutación, mapeo de status, **cada rama de error lanza `ServiceError` con el `status`+`payload` exactos**, passthrough del proxy preserva `shortText`. La rama mensual (`selected_days>=30`) sigue funcionando (sin proxy, status `mensualidad`).

**Step 4 — Quote codec** · S · deps: none
`lib/api/mcp/quote.ts`: `encodeQuote(ctx)`/`decodeQuote(blob)` + zod `QuoteContext`.
- *Escenario:* Un `QuoteContext` válido se codifica a un string opaco y se decodifica **idéntico**; un blob ausente/corrupto/alterado → `decodeQuote` lanza error legible en español, sin tocar el proxy.
- *Acceptance:* Unit round-trip + casos de rechazo (vacío, base64 inválido, JSON inválido, shape incompleto). Encoding determinista (sin `Date.now()`/random).

**Step 5 — MCP auth + prefijo middleware** · S · deps: none
`lib/api/mcp/auth.ts` `verifyApiKey(req)`; añadir `/api/mcp` a `PUBLIC_API_PREFIXES` (`middleware.ts`) **y actualizar el comentario load-bearing `middleware.ts:14-16`** que enumera qué prefijos usan `x-api-key` vs son fully-public (`/api/mcp` usa `x-api-key`).
- *Escenario:* Una request con `x-api-key` correcto (== `MCP_API_KEY`) resuelve `AuthInfo`; ausente o incorrecto → `undefined` (→ 401). El prefijo `/api/mcp` bypassa la sesión Supabase.
- *Acceptance:* Unit de `verifyApiKey` (match / no-match / ausente); test de que el prefijo está en la lista; comentario del middleware actualizado.

**Step 6 — Tool `buscar_disponibilidad` + mapeo del quote** · M · deps: 2, 4
En `lib/api/mcp/tools.ts`: inputSchema zod `(ciudad, fecha_recogida, fecha_devolucion, hora?, sede?, franchise?)`; handler resuelve code (location-directory) → `searchAvailability` → por categoría emite datos visibles **+ `quote` opaco** construido con el **mapeo availability→QuoteContext RESUELTO** del diseño §5.
- **Reconciliación CERRADA (2026-06-12):** se leyó el código de los dos funnels — convergen, mapeo idéntico. Fórmulas confirmadas (rama sin seguro total): `total_price = totalAmount + returnFeeAmount + taxFeeAmount`; `total_price_to_pay = estimatedTotalAmount`; `tax_fee=taxFeeAmount`; `iva_fee=IVAFeeAmount`; `coverage_days=coverageQuantity`; `coverage_price=coverageTotalAmount`; `return_fee=returnFeeAmount`; `extra_hours=extraHoursQuantity`; `extra_hours_price=extraHoursTotalAmount`. Implementar en `deriveStandardPricing(item)` testeable.
- **`selected_days` ⚠️:** replicar la regla de los funnels — diff de fechas pickup/return con redondeo (>4h suma un día), **NO** usar `numberDays` de disponibilidad. Función `computeSelectedDays(pickupDateTime, returnDateTime)` testeable.
- *Escenario:* `buscar_disponibilidad("bogota", fechas)` → categorías con precios COP, descripciones ES y un `quote` por categoría. Decodificar el `quote` reproduce los precios derivados (según las fórmulas confirmadas) y el `selected_days` calculado. Ciudad no resoluble → `isError` con sedes válidas. Error de negocio Localiza → `isError` con texto ES.
- *Acceptance:* Unit de `deriveStandardPricing` (item mock → `total_price`/`total_price_to_pay`/`tax_fee`/`iva_fee` == fórmulas §5) + `computeSelectedDays` (incl. caso borde >4h) + handler (directory + service mockeados): `quote` decodificable con todos los campos correctos; ramas de error → `isError`.

**Step 7 — Tool `crear_solicitud_reserva`** · M · deps: 3, 4
Handler: `decodeQuote` → merge con datos de cliente + `franchise` + extras opcionales → arma `CreateReservationInput` → `createReservation` → mapear `{reserveCode, reservationStatus}` → `{estado, numero_solicitud, mensaje}`. inputSchema expone extras (`extra_driver`, `baby_seat`, `wash`, `flight`...) como opcionales; ausentes = comportamiento estándar. **NO expone `total_insurance` (seguro total fuera de Fase 1, ver Non-goals); si llega `true`, rechazar con `isError`.**
- **Mapeo `QuoteContext` → `CreateReservationInput`** (tercera superficie de mapeo, tabular para no improvisar): renombres `pickupLocation→pickup_location`, `returnLocation→return_location`; **split de datetime** `pickupDateTime ("YYYY-MM-DDTHH:mm:ss") → pickup_date + pickup_hour`, `returnDateTime → return_date + return_hour`; el resto (`selected_days`, `category`, `reference_token`, `rate_qualifier`, precios `total_price`/`tax_fee`/`iva_fee`/`coverage_*`/`return_fee`/`extra_hours*`) pasa por nombre directo.
- *Escenario:* Con un `quote` válido + datos de cliente → crea la reserva real (branch testing) y devuelve `{estado, numero_solicitud, mensaje}` en ES. Con `quote` inválido/corrupto → `isError`, **NO** llama al service ni al proxy. `ServiceError` del service → `isError` con `shortText`/`message`/`error` ES. Customer existente NO se muta. (El MCP nunca produce mensual — solo estándar, ver Non-goals.)
- *Acceptance:* Unit del handler (service mockeado): construcción de `CreateReservationInput` desde quote+args, mapeo de salida, rechazo de quote inválido **sin** llamar al service, traducción de `ServiceError` a `isError`.

**Step 8 — Wire route handler MCP end-to-end** · S · deps: 1, 5, 6, 7
`app/api/mcp/[transport]/route.ts`: `createMcpHandler` registra ambas tools, `withMcpAuth(verifyApiKey)`, `runtime="nodejs"`, `basePath="/api/mcp"`, `maxDuration=120`. Quitar la tool `echo` del spike.
- *Escenario:* Inspector con `x-api-key` válido lista 2 tools; ejecuta `buscar_disponibilidad` → toma un `quote` → ejecuta `crear_solicitud_reserva` → reserva creada en branch testing. Sin key → rechazo.
- **Confirmar `maxDuration` contra latencia real:** medir el tiempo de `crear_solicitud_reserva` (incluye proxy Localiza + email inline, peor caso ~2min según #100). Si el plan Vercel del proyecto topa por debajo del peor caso, subir `maxDuration` o mover el email inline a `after()` para la ruta MCP (decisión a documentar; no romper paridad del endpoint público). Owner de la confirmación de límite = este step.
- *Acceptance:* QA manual runtime documentado (Inspector → branch testing Supabase), 2 tools, flujo de 2 pasos completo, 0 errores; latencia de creación medida y `maxDuration` justificado contra ella; `pnpm type-check`/`lint`/`build` verdes.

**Step 9 — Completar OpenAPI** · S · deps: 2
Completar `AvailabilityResponseItem` en `docs/apidog-rentacar-api.json` (coverage/extraHours/discount, fuente `proxy/src/localiza/availability.ts:152-174`) + documentar el endpoint MCP.
- *Escenario:* `GET /api/openapi` devuelve un `AvailabilityResponseItem` que coincide con el shape real que emite `searchAvailability`.
- *Acceptance:* Diff revisado; campos del spec == campos reales del item.

**Step 10 — Env templates + runbook conector** · S · deps: 5, 8
Añadir `MCP_API_KEY` a `.env.local.example` y `.env.staging.example`; runbook breve (cómo registrar/usar el conector, header de auth, ejemplo de flujo 2 pasos). **Documentar que `MCP_API_KEY` es un secreto DISTINTO de `RESERVATION_API_KEY`** (no reusar el mismo valor al provisionar en Vercel — rollout step 3).
- *Escenario:* Un dev nuevo encuentra `MCP_API_KEY` documentado y el runbook para registrar el conector.
- *Acceptance:* Templates actualizados; runbook en `docs/specs/issue-72-mcp-reservas/` o `docs/`.

---

## Chunk 3: Testing, rollout

### Testing strategy
Ver [../research/testing-strategy.md](../research/testing-strategy.md). Gate CI del repo: type-check → lint → test → build (todo secuencial, todo debe pasar). Cada paso funcional trae su escenario + tests antes/junto al código (SDD Iron Law). QA runtime manual con MCP Inspector contra branch de testing de Supabase.

### Rollout plan
1. PR con worktree aislado; review (pull-request skill: code-reviewer + security-reviewer + edge-case-detector + performance-engineer).
2. **No migración de schema** — #72 no toca DB schema (reusa tablas existentes). Sin `db push`.
3. `MCP_API_KEY` provisto en Vercel (env del proyecto, team info-42181061) antes de merge.
4. Deploy preview → QA con Inspector contra preview → merge a main → verificar prod con un `buscar_disponibilidad` real (sin crear reserva) o crear+cancelar una de prueba.
5. **Monitoreo:** logs de Vercel del endpoint `/api/mcp`; cruzar con `notification_logs` (snapshot de verdad) si se crea una reserva de prueba.

### Rollback
- El endpoint MCP es **aditivo**: revertir = quitar la ruta `/api/mcp` + el prefijo en middleware. Las extracciones (Steps 2-3) son behavior-preserving y quedan aunque se revierta el MCP (no rompen ninguno de los dos funnels).
- Si una extracción introdujera regresión en `/api/reservations*`: revertir ese commit específico restaura el handler inline.

### Riesgos abiertos (flagged)
- **Step 1 (zod 4 ↔ SDK):** si choca, puede forzar pin/aislamiento de zod — resolver antes de Steps 6-7.
- **Step 3 (extracción de reservas):** el path más sensible (lo consumen los DOS funnels `rentacar-web` + `rentacar-reservas` en prod — doble blast radius); behavior-preserving + tests del endpoint son el gate.
- **`maxDuration`:** confirmar el límite real del plan Vercel del proyecto; la creación puede tardar minutos (#100).
