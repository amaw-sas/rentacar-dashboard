import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiKey } from "@/lib/api/mcp/auth";
import {
  buscarDisponibilidad,
  buscarDisponibilidadInputSchema,
  crearSolicitudReserva,
  crearSolicitudReservaInputSchema,
} from "@/lib/api/mcp/tools";

// MCP server for AI reservation clients (issue #72). Streamable HTTP, stateless:
// the quote context round-trips in the tool args (no session store). The Localiza
// hop is made by the shared service functions, not here — the same path both
// public funnels use.
//
// Aligned with the public reservations route (issue #99): the proxy client aborts
// at PROXY_TIMEOUT_MS (28s) below this ceiling, so a slow Localiza fails fast with
// a retry-safe error instead of hanging — and the dashboard never inserts on the
// timeout path, so there is no phantom reservation on our side. The inline email
// after a successful insert is the only remaining tail; moving it to after() is the
// tracked perf follow-up. 30 mirrors the public route's maxDuration.
export const runtime = "nodejs";
export const maxDuration = 30;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "buscar_disponibilidad",
      {
        title: "Buscar disponibilidad",
        description:
          "Consulta vehículos disponibles por ciudad y fechas. Devuelve, por gama, " +
          "el precio en COP, descripción en español y un 'quote' opaco que debes " +
          "reenviar tal cual a crear_solicitud_reserva para la gama elegida.",
        inputSchema: buscarDisponibilidadInputSchema,
      },
      buscarDisponibilidad,
    );

    server.registerTool(
      "crear_solicitud_reserva",
      {
        title: "Crear solicitud de reserva",
        description:
          "Crea la reserva real en Localiza a partir de un 'quote' de " +
          "buscar_disponibilidad más los datos del cliente. Devuelve el estado y el " +
          "número de solicitud. No soporta seguro total en esta fase.",
        inputSchema: crearSolicitudReservaInputSchema,
      },
      crearSolicitudReserva,
    );
  },
  {
    serverInfo: { name: "rentacar-reservas", version: "1.0.0" },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 30,
    verboseLogs: false,
  },
);

// x-api-key shared-secret auth (Phase 1). `required: true` rejects any request
// without a valid key (401). Phase 2 swaps verifyApiKey for an OAuth verifier.
const authHandler = withMcpAuth(handler, (req) => verifyApiKey(req), {
  required: true,
});

export { authHandler as GET, authHandler as POST };
