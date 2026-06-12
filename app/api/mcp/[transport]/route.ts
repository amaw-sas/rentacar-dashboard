import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// SPIKE (Step 1, issue #72): minimal MCP endpoint to de-risk mcp-handler + SDK
// + zod 4 compatibility on Next.js 16. The `echo` tool is throwaway — Step 8
// replaces it with the real `buscar_disponibilidad` / `crear_solicitud_reserva`
// tools under withMcpAuth. Do NOT build on this file's contents.

export const runtime = "nodejs";

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "echo",
      {
        title: "Echo",
        description: "Echoes back the provided message (spike).",
        inputSchema: { message: z.string().describe("Message to echo") },
      },
      async ({ message }) => ({
        content: [{ type: "text", text: `Echo: ${message}` }],
      })
    );
  },
  {
    serverInfo: { name: "rentacar-reservas", version: "0.0.1-spike" },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: false,
  }
);

export { handler as GET, handler as POST };
