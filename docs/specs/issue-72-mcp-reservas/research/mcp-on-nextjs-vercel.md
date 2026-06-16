# Research — MCP server en Next.js 16 / Vercel con Streamable HTTP

**Fecha:** 2026-06-12 · **Fuente:** Context7 — `/vercel/mcp-handler` (High reputation, 58 snippets) + `/modelcontextprotocol/typescript-sdk/v1.29.0` (la versión que ya está en el lockfile). **No** de memoria (CLAUDE.md).

## Recomendación: `mcp-handler` (adaptador oficial de Vercel) sobre el SDK pelado

| Opción | Qué es | Veredicto |
|---|---|---|
| **`mcp-handler`** (Vercel) | Wrapper sobre `@modelcontextprotocol/sdk` específico para route handlers de Next.js App Router. Maneja el transporte Streamable HTTP, el dispatch GET/POST/DELETE, sesiones opcionales. | **Elegido.** Mínimo boilerplate, mantenido por Vercel, encaja con App Router. |
| `@modelcontextprotocol/sdk` directo | Instanciar `McpServer` + `StreamableHTTPServerTransport` a mano dentro del handler | Más código de transporte/sesión que `mcp-handler` ya resuelve. Innecesario. |

`mcp-handler` depende de `@modelcontextprotocol/sdk` — ambos pasan a **dependencias directas** (hoy el SDK está solo transitivo vía `shadcn`).

## Patrón de route handler (confirmado)

```typescript
// app/api/mcp/[transport]/route.ts
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "buscar_disponibilidad",
      { title: "...", description: "...", inputSchema: { ciudad: z.string(), /* ... */ } },
      async (args, extra) => ({ content: [{ type: "text", text: "..." }] })
    );
    // server.registerTool("crear_solicitud_reserva", ...)
  },
  { serverInfo: { name: "rentacar-reservas", version: "1.0.0" }, capabilities: { tools: {} } },
  { basePath: "/api/mcp", maxDuration: 120, verboseLogs: process.env.NODE_ENV === "development" }
);
export { handler as GET, handler as POST };
```

- **`basePath` debe coincidir** con la ubicación del segmento `[transport]` → ruta `app/api/mcp/[transport]/route.ts`, `basePath: "/api/mcp"`.
- **`runtime = "nodejs"`** obligatorio (toca admin client / lógica que lee service-role; precedente `app/api/locations/route.ts:11`).
- Tools devuelven `{ content: [{ type: "text", text }] }`. Errores: `isError: true` o lanzar (el SDK lo convierte a `isError` automáticamente — `mcp.ts createToolError`).
- `inputSchema` se define con **campos zod sueltos** (no un `z.object(...)` envolvente); el SDK los convierte a JSON Schema 2020-12.

## ✅ Decisión clave: servidor STATELESS — el estado opaco viaja en los argumentos del tool

El SDK soporta modo stateless (`sessionIdGenerator: undefined`; sin Redis). **Para #72 el modo correcto es stateless** porque:

- El estado opaco de cotización (`referenceToken` + `rateQualifier` + `categoryCode` + precios + fechas + sedes + `selected_days`) **lo retiene el CLIENTE MCP (la IA), no el servidor.**
- `buscar_disponibilidad` devuelve, por cada categoría, un **blob opaco `quote`** (todo el contexto serializado). La IA elige una categoría y **reenvía ese `quote` intacto** como argumento de `crear_solicitud_reserva`.
- El servidor no guarda sesión entre llamadas → no necesita Redis, no hay TTL de sesión que expire, escala sin estado en Vercel.

Esto resuelve el "riesgo de estado opaco entre 2 llamadas" del discovery: **se vuelve un contrato explícito de datos** (campo `quote` de salida → entrada), no una sesión frágil. El riesgo residual (la IA no reenvía el blob) se mitiga con validación dura en `crear_solicitud_reserva` (rechazar si falta/inválido) y `description` del tool que instruye reenviarlo.

## Auth: `withMcpAuth` — Fase 1 x-api-key, Fase 2 OAuth sin reescribir tools

`mcp-handler` exporta `withMcpAuth(handler, verifyToken, options)`. `verifyToken(req, bearerToken)` recibe el `Request` completo (puede leer cualquier header) y devuelve `AuthInfo | undefined` (undefined → 401).

- **Fase 1 (x-api-key):** `verifyToken` lee `req.headers.get("x-api-key")`, compara estricto con `process.env.MCP_API_KEY`; match → `AuthInfo` mínimo, no-match → `undefined`. Réplica del patrón `reservations/route.ts:92-98` pero dentro del contrato MCP. Nuevo prefijo `/api/mcp` en `PUBLIC_API_PREFIXES` (`middleware.ts`) para bypassear sesión Supabase.
- **Fase 2 (OAuth):** se cambia SOLO la función `verifyToken` (valida JWT/bearer del flujo OAuth del spec MCP) + `resourceMetadataPath` para el discovery `/.well-known/oauth-protected-resource`. **Las herramientas no cambian.** La estructura `withMcpAuth` deja la puerta abierta tal como pidió la decisión de discovery.

## Riesgos / spikes a verificar en implementación

1. **Compatibilidad zod 4 ↔ SDK/mcp-handler.** El repo usa `zod@4.3` (`stack.md`); el SDK v1.29 y los ejemplos usan zod. Verificar que `registerTool` acepta esquemas zod v4 sin choque de peer-deps (el SDK históricamente pinneaba zod v3). **Spike corto antes de codear las tools.** Si choca: aislar zod del SDK o pinnear.
2. **`maxDuration` vs latencia de creación.** `crear_solicitud_reserva` incluye proxy Localiza + email inline → puede tardar 20s–2min (memoria incidente 504 / issue #100). Subir `maxDuration` (≥120s) y confirmar el límite del plan Vercel del proyecto. SSE resumability (Redis) NO necesario por ser stateless.
3. **`[transport]` dynamic segment.** El handler debe vivir en `app/api/mcp/[transport]/route.ts` (no `app/api/mcp/route.ts`) — el segmento `[transport]` es parte del contrato de `mcp-handler`.
