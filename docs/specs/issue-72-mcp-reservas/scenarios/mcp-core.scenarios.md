---
name: mcp-core
created_by: orchestrator
created_at: 2026-06-12T00:00:00Z
---

# Holdout — Steps 4-10: MCP core (quote codec, auth, 2 tools, wiring, OpenAPI, env)

Contrato: sobre las funciones de servicio ya extraídas (`searchAvailability` / `createReservation`),
montar el servidor MCP Streamable HTTP stateless con 2 tools, auth `x-api-key` (Fase 1) y el
estado de cotización como blob opaco `quote`. **Solo reservas estándar** (sin mensual, sin seguro
total — ver Non-goals del diseño). Mapeo de precio = el RESUELTO del diseño §5 (convergente entre
los dos funnels). Estos escenarios encodan los invariantes; cada uno se codifica como test antes/junto
al código (SDD Iron Law). El contrato de `/api/reservations*` (dos funnels) NO cambia.

---

## Step 4 — Quote codec (`lib/api/mcp/quote.ts`)

### SCEN-101: round-trip idéntico
**Given**: un `QuoteContext` válido (todos los campos del shape §5: sedes, datetimes, `selected_days`,
`categoryCode`, `referenceToken`, `rateQualifier`, precios)
**When**: `encodeQuote(ctx)` → string opaco → `decodeQuote(blob)`
**Then**: el objeto decodificado es **profundamente igual** al original; el encode es determinista
(sin `Date.now()`/random) — el mismo `ctx` produce el mismo string
**Evidence**: `expect(decodeQuote(encodeQuote(ctx))).toEqual(ctx)` + igualdad de dos encodes del mismo ctx

### SCEN-102: blob ausente/vacío → error legible ES
**Given**: `decodeQuote("")` o `decodeQuote(undefined as unknown as string)`
**When**: se invoca
**Then**: lanza un error con mensaje en español ("cotización inválida o expirada…"); NO toca proxy ni red
**Evidence**: error lanzado + mensaje ES

### SCEN-103: base64/JSON corrupto → error legible ES
**Given**: `decodeQuote("!!!no-es-base64!!!")` y `decodeQuote(base64url("no json válido"))`
**When**: se invoca
**Then**: lanza error ES; no expone stack interno como mensaje de usuario
**Evidence**: error lanzado + mensaje ES

### SCEN-104: shape incompleto/alterado → error legible ES
**Given**: un blob que decodifica a JSON válido pero le falta `referenceToken` (o `selected_days` ≤ 0,
o un precio no-numérico)
**When**: `decodeQuote` valida con zod
**Then**: lanza error ES (cotización inválida); el shape parcial NO pasa
**Evidence**: error lanzado por el rechazo de zod

---

## Step 5 — MCP auth + prefijo middleware (`lib/api/mcp/auth.ts`, `middleware.ts`)

### SCEN-105: x-api-key correcto → AuthInfo
**Given**: `MCP_API_KEY` configurada y una request con header `x-api-key` == `MCP_API_KEY`
**When**: `verifyApiKey(req)`
**Then**: devuelve un `AuthInfo` (`token`, `clientId`, `scopes`) — la request queda autenticada
**Evidence**: retorno truthy con shape AuthInfo

### SCEN-106: x-api-key ausente o incorrecto → undefined
**Given**: request sin `x-api-key`, o con un valor distinto de `MCP_API_KEY`, o `MCP_API_KEY` no configurada
**When**: `verifyApiKey(req)`
**Then**: devuelve `undefined` (→ 401 en el handler MCP). NUNCA autentica con key vacía/ausente
**Evidence**: retorno `undefined` en los 3 casos

### SCEN-107: prefijo /api/mcp bypassa sesión Supabase y usa x-api-key
**Given**: `PUBLIC_API_PREFIXES` del middleware
**When**: se inspecciona la lista y el comentario load-bearing
**Then**: `/api/mcp` está en la lista (bypassa `updateSession`); el comentario documenta que `/api/mcp`
autentica por `x-api-key` (no fully-public). Los prefijos existentes intactos (dos funnels sin cambios)
**Evidence**: assert sobre la constante + revisión del comentario

---

## Step 6 — Tool `buscar_disponibilidad` (`lib/api/mcp/tools.ts`)

### SCEN-108: deriveStandardPricing replica las fórmulas §5 (sin seguro total)
**Given**: un availability item Localiza (camelCase: `totalAmount`, `estimatedTotalAmount`, `taxFeeAmount`,
`IVAFeeAmount`, `coverageQuantity`, `coverageTotalAmount`, `returnFeeAmount`, `extraHoursQuantity`,
`extraHoursTotalAmount`)
**When**: `deriveStandardPricing(item)`
**Then**: `total_price == totalAmount + returnFeeAmount + taxFeeAmount` (NO incluye IVA);
`total_price_to_pay == estimatedTotalAmount`; `tax_fee == taxFeeAmount`; `iva_fee == IVAFeeAmount`;
`coverage_days == coverageQuantity`; `coverage_price == coverageTotalAmount`; `return_fee == returnFeeAmount`;
`extra_hours == extraHoursQuantity`; `extra_hours_price == extraHoursTotalAmount`
**Evidence**: igualdad campo a campo contra el item mock

### SCEN-109: computeSelectedDays — diff de fechas con regla >4h suma día (NO numberDays)
**Given**: pares pickup/return: (a) exacto 4 días → 4; (b) 4 días + 3h → 4; (c) 4 días + 5h → 5;
(d) mismo día +2h → 1 (single-day nunca 0)
**When**: `computeSelectedDays(pickupDateTime, returnDateTime)`
**Then**: devuelve los días según la regla de los funnels (resto >4h suma un día); positivo siempre
**Evidence**: igualdad contra los casos tabulados, incl. el borde 4h

### SCEN-110: tool feliz → categorías ES + quote decodificable por categoría
**Given**: `buscar_disponibilidad("bogota", fecha_recogida, fecha_devolucion)` con directorio + service mockeados
(el directorio resuelve "bogota"→code; el service devuelve categorías)
**When**: se ejecuta el handler
**Then**: devuelve por categoría datos visibles (código, descripción ES, precios COP) **+ un `quote` opaco**;
`decodeQuote(quote)` reproduce los precios derivados (fórmulas §5) y el `selected_days` calculado, con
`referenceToken`/`rateQualifier` de esa categoría y las sedes/datetimes resueltos del input
**Evidence**: salida de la tool + `decodeQuote` de cada quote == campos esperados

### SCEN-111: ciudad no resoluble → isError con sedes válidas
**Given**: `buscar_disponibilidad("ciudad-inexistente", …)` y el directorio no resuelve code
**When**: se ejecuta
**Then**: `isError: true` con texto ES que lista sedes/ciudades válidas; NO llama a `searchAvailability`
**Evidence**: salida `isError` + ausencia de llamada al service

### SCEN-112: error de negocio Localiza → isError con texto ES
**Given**: el directorio resuelve, pero `searchAvailability` lanza `ServiceError` (negocio/horario)
**When**: se ejecuta
**Then**: `isError: true` con el texto ES del payload (`shortText ?? message ?? error`)
**Evidence**: salida `isError` con el mensaje ES

### SCEN-121: rango no-positivo → isError limpio (no excepción) — regresión review #72
**Given**: `buscar_disponibilidad` con duración no-positiva — mismo día con `hora_recogida == hora_devolucion`,
rango invertido (devolución antes que recogida), o fecha inválida (`2026-13-45`)
**When**: se ejecuta (la regla de los funnels da `selected_days = 0`)
**Then**: `isError: true` con mensaje ES ("la devolución debe ser posterior a la recogida"); **NO** lanza
excepción no capturada ni llama a `searchAvailability`. `encodeQuote` nunca recibe `selected_days = 0`
**Evidence**: salida `isError`; sin throw; spy de `searchAvailability` con 0 llamadas

### SCEN-122: hora fuera de rango → isError limpio — regresión review #72
**Given**: `hora_recogida` u `hora_devolucion` con formato de dígitos pero fuera de rango (`25:00`, `10:60`)
**When**: se ejecuta
**Then**: `isError: true` con mensaje ES sobre formato HH:mm 24h; **NO** construye un datetime inválido ni lanza
**Evidence**: salida `isError`

### SCEN-123: item de disponibilidad inválido se omite (degradación) — regresión review #72
**Given**: el proxy devuelve un array con un item al que le falta un campo numérico (→ `NaN` en el pricing)
junto a items válidos
**When**: se construyen las categorías
**Then**: el item inválido se **omite** (no rompe la respuesta); se devuelven las gamas que cotizaron bien;
si **ninguna** cotiza, `isError` limpio
**Evidence**: salida con las categorías válidas; el item NaN ausente; caso all-fail → `isError`

> Nota: el `hora` único del diseño original se separó en `hora_recogida`/`hora_devolucion` (ambas default
> 10:00) para permitir alquileres del mismo día — el `hora` único hacía toda búsqueda mismo-día degenerar
> a duración 0. SCEN-110 usa los defaults (mismo resultado que antes).

---

## Step 7 — Tool `crear_solicitud_reserva` (`lib/api/mcp/tools.ts`)

### SCEN-113: quote válido + cliente → reserva creada, salida ES
**Given**: un `quote` válido (de `buscar_disponibilidad`) + datos de cliente + `franchise`, con `createReservation` mockeado devolviendo `{reserveCode, reservationStatus}`
**When**: se ejecuta el handler
**Then**: arma `CreateReservationInput` desde `decodeQuote(quote)` + args (split datetime
`pickupDateTime→pickup_date+pickup_hour`, `returnDateTime→return_date+return_hour`; renombres
`pickupLocation→pickup_location`, etc.) y devuelve `{estado, numero_solicitud, mensaje}` en ES
**Evidence**: input pasado a `createReservation` (mapeo correcto) + salida ES mapeada

### SCEN-114: quote inválido/corrupto → isError SIN llamar al service
**Given**: `crear_solicitud_reserva(quote_corrupto, …)`
**When**: se ejecuta
**Then**: `isError: true` ("cotización inválida o expirada, vuelve a buscar disponibilidad");
`createReservation` **nunca** se invoca (sin proxy, sin reserva fantasma)
**Evidence**: salida `isError` + spy de `createReservation` con 0 llamadas

### SCEN-115: ServiceError del service → isError con texto ES
**Given**: quote válido, pero `createReservation` lanza `ServiceError` (p.ej. passthrough proxy con `shortText`)
**When**: se ejecuta
**Then**: `isError: true` con el texto ES (`payload.shortText ?? message ?? error`)
**Evidence**: salida `isError` con el mensaje del payload

### SCEN-116: total_insurance=true → rechazo (seguro total fuera de Fase 1)
**Given**: el inputSchema NO expone `total_insurance`; si por algún camino llega `true`
**When**: se ejecuta
**Then**: `isError: true` (seguro total no soportado en Fase 1); no se crea reserva con seguro total
**Evidence**: salida `isError`; el `CreateReservationInput` armado nunca lleva `total_insurance: true`

### SCEN-117: customer existente NO se muta (heredado de createReservation)
**Given**: el service usa `findOrCreateCustomer` lenient + snapshot (#25/#26)
**When**: la tool crea la reserva
**Then**: la tool no introduce mutación; delega en `createReservation`, que no reescribe el customer
**Evidence**: el handler solo arma input y llama al service (sin escritura propia a customers)

---

## Step 8 — Wiring end-to-end (`app/api/mcp/[transport]/route.ts`)

### SCEN-118: Inspector con key válida lista 2 tools y ejecuta el flujo de 2 pasos
**Given**: el endpoint montado con `createMcpHandler` + `withMcpAuth(verifyApiKey)`, `runtime="nodejs"`,
`basePath="/api/mcp"`, `maxDuration` justificado contra la latencia real de creación; la tool `echo` del spike eliminada
**When**: un cliente MCP (Inspector) con `x-api-key` válido conecta contra la branch de testing
**Then**: lista exactamente 2 tools (`buscar_disponibilidad`, `crear_solicitud_reserva`); ejecuta
`buscar_disponibilidad` → toma un `quote` → ejecuta `crear_solicitud_reserva` → reserva creada en testing;
sin key → rechazo
**Evidence**: QA runtime documentado (Inspector → branch testing), 0 errores; latencia medida vs maxDuration

---

## Step 9 — OpenAPI (`docs/apidog-rentacar-api.json`)

### SCEN-119: AvailabilityResponseItem coincide con el shape real
**Given**: el shape que emite `searchAvailability` (fuente `proxy/src/localiza/availability.ts:152-174`)
**When**: se compara con `AvailabilityResponseItem` del OpenAPI servido por `GET /api/openapi`
**Then**: los campos del spec == campos reales del item (incl. coverage/extraHours/discount)
**Evidence**: test de doc-parity verde

---

## Step 10 — Env templates + runbook

### SCEN-120: MCP_API_KEY documentada como secreto distinto
**Given**: `.env.local.example`, `.env.staging.example` y un runbook
**When**: un dev nuevo los lee
**Then**: encuentra `MCP_API_KEY` documentada, con nota explícita de que es un secreto **distinto** de
`RESERVATION_API_KEY` (no reusar el valor); y el runbook para registrar/usar el conector (header + flujo 2 pasos)
**Evidence**: templates actualizados + runbook presente
