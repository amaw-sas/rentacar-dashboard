import { createMcpHandler } from "mcp-handler";
import {
  buscarDisponibilidad,
  buscarDisponibilidadInputSchema,
  buscarDisponibilidadAnnotations,
  buscarDisponibilidadOutputSchema,
  crearSolicitudReserva,
  crearSolicitudReservaInputSchema,
  crearSolicitudReservaAnnotations,
  crearSolicitudReservaOutputSchema,
} from "@/lib/api/mcp/tools";
import { withChatGptConnectorCompat } from "@/lib/api/mcp/http";

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
        outputSchema: buscarDisponibilidadOutputSchema,
        annotations: buscarDisponibilidadAnnotations,
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
        outputSchema: crearSolicitudReservaOutputSchema,
        annotations: crearSolicitudReservaAnnotations,
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

// Intentionally ANONYMOUS (issue #172): no OAuth, no x-api-key. End customers
// connect by URL and the AI client reaches the tools unauthenticated. Anti-abuse
// is layered elsewhere: (a) the quote is HMAC-signed + expiring (lib/api/mcp/quote.ts)
// so prices can't be forged or replayed, and (b) Vercel Firewall rate-limits the
// endpoint at the platform level (not configured in code). Reservations enter
// status `nueva` for operator review, so nothing is auto-confirmed.
//
// The handler is wrapped (issue #172 WS3) so the ChatGPT connector can reach it:
// the wrapper answers ChatGPT's empty-body liveness probe with a 200 and
// normalizes a wildcard Accept the SDK would otherwise 406. See lib/api/mcp/http.ts.
const chatgptReadyHandler = withChatGptConnectorCompat(handler);
export { chatgptReadyHandler as GET, chatgptReadyHandler as POST };
