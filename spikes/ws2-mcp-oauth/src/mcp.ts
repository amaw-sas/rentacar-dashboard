// MCP server factory: registers the two spike tools and returns a fresh
// stateless StreamableHTTP transport wired to a fresh server per request.
//
// Gating is NOT done here — crear_reserva's HTTP 401 is emitted at the
// transport boundary in server.ts (peek-before-transport). Inside the tool we
// can assume the Bearer was already verified; we return the canned success.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "ws2-spike-mcp", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  // Anonymous query tool — representative of the free tools in #172.
  server.registerTool(
    "buscar_disponibilidad",
    {
      description:
        "Consulta disponibilidad de vehiculos (anonima, sin autenticacion).",
      inputSchema: {
        ciudad: z.string(),
        fecha_recogida: z.string(),
        fecha_entrega: z.string(),
      },
    },
    async ({ ciudad, fecha_recogida, fecha_entrega }) => {
      const payload = {
        ciudad,
        fecha_recogida,
        fecha_entrega,
        disponibilidad: [
          {
            categoria: "Economico",
            modelo_ejemplo: "Chevrolet Spark o similar",
            precio_dia: 120000,
            moneda: "COP",
            // Opaque token the client carries into crear_reserva.
            quote: "QUOTE-SPIKE-ECON-0001",
          },
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  // Gated reservation tool. By the time the callback runs, the Bearer has
  // already been verified at the transport boundary (server.ts). Canned result.
  server.registerTool(
    "crear_reserva",
    {
      description:
        "Crea una reserva (GATEADA: requiere Bearer con scope reservation:create).",
      inputSchema: {
        quote: z.string(),
        nombre: z.string(),
        email: z.string(),
      },
    },
    async ({ quote, nombre, email }) => {
      const payload = {
        status: "ok",
        codigo: "SPIKE-TEST-001",
        quote,
        nombre,
        email,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  return server;
}

// Fresh server + stateless transport per request. enableJsonResponse so the
// reference client gets a plain application/json body (no SSE framing) which
// keeps the raw JSON-RPC asserts simple.
export async function createTransport(): Promise<StreamableHTTPServerTransport> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport;
}
