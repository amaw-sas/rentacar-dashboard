import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mock the MCP handler the chat wrapper delegates to (same seam as tools.test.ts
// mocking buscarDisponibilidad).
const crearSolicitudReserva = vi.fn();
vi.mock("@/lib/api/mcp/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mcp/tools")>();
  return { ...actual, crearSolicitudReserva };
});

import { runCrearReserva } from "@/lib/chat/reserva-tool";

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

const baseArgs = {
  quote: "q-token",
  fullname: "Juan Pérez",
  identification_type: "CC",
  identification: "123456",
  email: "juan@example.com",
  phone: "3001234567",
  franchise: "alquilatucarro",
};

describe("runCrearReserva", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok:true with the parsed confirmation on success", async () => {
    crearSolicitudReserva.mockResolvedValue(
      textResult(
        JSON.stringify({
          estado: "reservado",
          numero_solicitud: "AVX123",
          mensaje: "ok",
        }),
      ),
    );
    const r = await runCrearReserva(baseArgs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ numero_solicitud: "AVX123" });
  });

  it("relays the service error message (e.g. expired quote)", async () => {
    crearSolicitudReserva.mockResolvedValue(
      textResult(
        "La cotización es inválida o expiró. Vuelve a buscar disponibilidad.",
        true,
      ),
    );
    const r = await runCrearReserva(baseArgs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cotización/i);
  });

  it("passes the franchise and minimal fields through to the handler", async () => {
    crearSolicitudReserva.mockResolvedValue(
      textResult(JSON.stringify({ numero_solicitud: "X" })),
    );
    await runCrearReserva(baseArgs);
    expect(crearSolicitudReserva).toHaveBeenCalledWith(
      expect.objectContaining({
        franchise: "alquilatucarro",
        fullname: "Juan Pérez",
        quote: "q-token",
        email: "juan@example.com",
      }),
    );
  });

  it("fails gracefully when the result text is not valid JSON", async () => {
    crearSolicitudReserva.mockResolvedValue(textResult("no soy json"));
    const r = await runCrearReserva(baseArgs);
    expect(r.ok).toBe(false);
  });
});
