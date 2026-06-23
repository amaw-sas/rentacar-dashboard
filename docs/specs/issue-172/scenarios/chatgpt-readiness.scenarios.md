---
name: chatgpt-readiness
created_by: pablo+claude
created_at: 2026-06-23T00:00:00Z
issue: 172
---

# WS3 — Readiness del conector ChatGPT para el MCP anónimo

Contexto: el server `/api/mcp` es anónimo + quote firmado (#190, en prod). El
conector de ChatGPT no conecta ni ejecuta tools por dos bloqueadores verificados
en vivo: el probe de conexión recibe 406, y las tools no exponen `annotations`
ni `outputSchema`. Estos escenarios fijan el comportamiento que debe satisfacer
al conector de ChatGPT sin romper a Claude ni al server anónimo ya deployado.

## SCEN-W1: el probe de conexión de ChatGPT recibe 200, no 406
**Given**: el server MCP en `/api/mcp/[transport]`
**When**: llega un `POST` con body vacío y `Accept: */*` (el liveness probe que ChatGPT manda al crear el conector)
**Then**: la respuesta es `200` con cuerpo JSON `{ "ok": true }` — nunca `406`
**Evidence**: status code + cuerpo de la `Response` retornada por el handler del route

## SCEN-W2: un mensaje MCP real con Accept comodín se atiende, no se rechaza
**Given**: el server MCP en `/api/mcp/[transport]`
**When**: llega un `POST` con un `initialize` JSON-RPC válido pero `Accept: */*` (sin `text/event-stream` literal)
**Then**: el Accept se normaliza a `application/json, text/event-stream` antes de delegar al SDK, y la respuesta NO es `406` (el SDK procesa el initialize)
**Evidence**: status code de la `Response` (≠406) + el `Accept` recibido por el handler interno del SDK

## SCEN-W3: un cliente conforme (Claude) no regresiona
**Given**: el server MCP en `/api/mcp/[transport]`
**When**: llega un `POST` con `Accept: application/json, text/event-stream` y un mensaje JSON-RPC válido (el camino que ya usa Claude/curl)
**Then**: el handler delega al SDK sin alterar el Accept ni el body, y responde igual que antes del cambio
**Evidence**: status code + el body/headers efectivamente reenviados al SDK (sin mutación)

## SCEN-W4: tools/list expone annotations y outputSchema en ambas tools
**Given**: el server MCP con las dos tools registradas
**When**: se invoca `tools/list`
**Then**: `buscar_disponibilidad` trae `annotations.readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`; `crear_solicitud_reserva` trae `annotations.readOnlyHint=false`, `destructiveHint=false`, `idempotentHint=false`, `openWorldHint=true`; ambas traen un `outputSchema` no vacío
**Evidence**: el JSON de respuesta de `tools/list` (campos `annotations` y `outputSchema` por tool)

## SCEN-W5: el éxito de buscar_disponibilidad valida contra su outputSchema
**Given**: `buscar_disponibilidad` con `outputSchema` declarado y disponibilidad real (≥1 gama)
**When**: el handler retorna su resultado de éxito
**Then**: el `CallToolResult` incluye `structuredContent` con `{ sede, dias, categorias[] }` donde cada categoría tiene `categoria, descripcion, dias, precio_total, precio_a_pagar, iva, quote` — y el SDK NO lanza `Output validation error`
**Evidence**: el objeto `structuredContent` del resultado + ausencia de `McpError` al validar contra el schema

## SCEN-W6: el éxito de crear_solicitud_reserva valida contra su outputSchema
**Given**: `crear_solicitud_reserva` con `outputSchema` declarado y una reserva creada
**When**: el handler retorna su resultado de éxito
**Then**: el `CallToolResult` incluye `structuredContent` con `{ estado, numero_solicitud, mensaje }` (todos string) — y el SDK NO lanza `Output validation error`
**Evidence**: el objeto `structuredContent` del resultado + ausencia de `McpError` al validar contra el schema

## SCEN-W7: GET sigue pasando al SDK
**Given**: el server MCP en `/api/mcp/[transport]`
**When**: llega un `GET` (apertura de stream SSE)
**Then**: el handler delega al SDK (con Accept normalizado si hiciera falta) sin short-circuit de probe
**Evidence**: la `Response` proviene del handler del SDK, no del camino `{ok:true}`

## SCEN-W8 (regresión): los errores no llevan structuredContent y siguen igual
**Given**: cualquier tool con `outputSchema` declarado
**When**: el handler retorna un resultado de error (`isError: true`, p. ej. quote inválido, ciudad no resuelta, sin disponibilidad)
**Then**: el resultado NO incluye `structuredContent` (el SDK exime los errores de validar el schema) y conserva su mensaje en español — los SCEN-101..136 actuales siguen verdes
**Evidence**: el `CallToolResult` de error (sin `structuredContent`) + suite `tests/unit/api/mcp/*` verde
