import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// runCotizar wraps the existing MCP tool `buscarDisponibilidad` and unwraps its
// CallToolResult into a discriminated result the AI SDK agent relays to the user.
// We mock the MCP tool so these tests stay unit-scoped (no Localiza / Supabase).

const buscarDisponibilidad = vi.fn();

vi.mock("@/lib/api/mcp/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mcp/tools")>();
  return { ...actual, buscarDisponibilidad };
});

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

describe("runCotizar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:true with the parsed quote JSON on success", async () => {
    const payload = {
      sede: "BOG",
      dias: 4,
      categorias: [
        { categoria: "ECONOMY", precio_total: 150000, quote: "abc" },
      ],
    };
    buscarDisponibilidad.mockResolvedValue(
      textResult(JSON.stringify(payload, null, 2)),
    );

    const { runCotizar } = await import("@/lib/chat/tools");
    const out = await runCotizar({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(out).toEqual({ ok: true, data: payload });
    expect(buscarDisponibilidad).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false with the tool's ES message when isError is set", async () => {
    buscarDisponibilidad.mockResolvedValue(
      textResult(
        'No encuentro una sede para "Pereiro". Ciudades disponibles: Bogotá, Cali.',
        true,
      ),
    );

    const { runCotizar } = await import("@/lib/chat/tools");
    const out = await runCotizar({
      ciudad: "Pereiro",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(out).toEqual({
      ok: false,
      message:
        'No encuentro una sede para "Pereiro". Ciudades disponibles: Bogotá, Cali.',
    });
  });

  it("returns ok:false on malformed (non-JSON) success text", async () => {
    buscarDisponibilidad.mockResolvedValue(textResult("not-json"));

    const { runCotizar } = await import("@/lib/chat/tools");
    const out = await runCotizar({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(out.ok).toBe(false);
  });
});
