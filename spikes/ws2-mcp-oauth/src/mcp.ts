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
      title: "Buscar disponibilidad de autos",
      description:
        "Use this when the user wants to search or check available rental cars, prices, or vehicle options for a city and a date range. Call this tool to look up car rental availability and quotes.",
      annotations: {
        title: "Buscar disponibilidad de autos",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        ciudad: z.string().describe("Ciudad de recogida, p.ej. Bogotá"),
        fecha_recogida: z.string().describe("Fecha de recogida en formato YYYY-MM-DD"),
        fecha_entrega: z.string().describe("Fecha de entrega en formato YYYY-MM-DD"),
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
      title: "Crear reserva de auto",
      description:
        "Use this when the user wants to book or confirm a car rental reservation using a quote returned by buscar_disponibilidad. Call this tool to create the reservation.",
      annotations: {
        title: "Crear reserva de auto",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        quote: z.string().describe("Token de cotización devuelto por buscar_disponibilidad (campo quote)"),
        nombre: z.string().describe("Nombre completo del cliente que reserva"),
        email: z.string().describe("Correo electrónico del cliente"),
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
