import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the underlying tool wrapper so these stay unit-scoped (no Localiza/Supabase).
const { runCotizar } = vi.hoisted(() => ({ runCotizar: vi.fn() }));
vi.mock("@/lib/chat/tools", () => ({ runCotizar }));

import {
  getQuoteTable,
  findGama,
} from "@/lib/chat/orchestrator/quote-service";

const ARGS = {
  ciudad: "bogota",
  fecha_recogida: "2026-07-01",
  fecha_devolucion: "2026-07-04",
};

beforeEach(() => {
  runCotizar.mockReset();
});

describe("getQuoteTable", () => {
  it("flattens categorias and surfaces the extra-hour line item", async () => {
    runCotizar.mockResolvedValue({
      ok: true,
      data: {
        sede: "AABOG01",
        dias: 3,
        categorias: [
          {
            categoria: "C",
            descripcion: "Gama C Económico",
            dias: 3,
            precio_a_pagar: 300000,
            precio_total: 310000,
            precio_hora_extra: 5000,
            horas_extra: 2,
            quote: "blob-c",
          },
          {
            categoria: "F",
            descripcion: "Gama F Sedán",
            dias: 3,
            precio_a_pagar: 350000,
            precio_hora_extra: 0,
            horas_extra: 0,
            quote: "blob-f",
          },
        ],
      },
    });

    const res = await getQuoteTable(ARGS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.table.sede).toBe("AABOG01");
    expect(res.table.filas).toHaveLength(2);

    const c = res.table.filas[0];
    expect(c.categoria).toBe("C");
    expect(c.precioTotal).toBe(300000); // prefers precio_a_pagar (all-in)
    expect(c.precioHoraExtra).toBe(5000);
    expect(c.horasExtra).toBe(2);
    expect(c.quote).toBe("blob-c");

    // findGama is case-insensitive and returns undefined for unknown codes.
    expect(findGama(res.table, "f")?.precioTotal).toBe(350000);
    expect(findGama(res.table, "X")).toBeUndefined();
  });

  it("relays the human error message from a failed quote", async () => {
    runCotizar.mockResolvedValue({
      ok: false,
      message: "No tengo sede en X. Ciudades con servicio: Bogotá, Cali.",
    });
    const res = await getQuoteTable(ARGS);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("No tengo sede");
  });

  it("returns a no-availability message when categorias is empty", async () => {
    runCotizar.mockResolvedValue({
      ok: true,
      data: { sede: "X", dias: 1, categorias: [] },
    });
    const res = await getQuoteTable(ARGS);
    expect(res.ok).toBe(false);
  });
});
