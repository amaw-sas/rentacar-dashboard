import { describe, it, expect } from "vitest";
import { resolveGamaCode } from "@/lib/chat/orchestrator/blocks";
import type { QuoteTable } from "@/lib/chat/orchestrator/quote-service";

const row = (categoria: string, descripcion: string) => ({
  categoria,
  descripcion,
  dias: 3,
  precioTotal: 500000,
  precioHoraExtra: 0,
  horasExtra: 0,
  quote: `blob-${categoria}`,
});

// Includes the risky codes LE/LU (collide with common words "le"/"lu") and 1-char C/F.
const TABLE: QuoteTable = {
  sede: "AAMDL",
  dias: 3,
  filas: [
    row("C", "Económico Mecánico"),
    row("CX", "Económico Automático"),
    row("F", "Sedán Mecánico"),
    row("FX", "Sedán Automático"),
    row("GC", "Camioneta Automática"),
    row("G4", "Camioneta Mecánica 4X4"),
    row("GY", "SUV Automática 7 puestos"),
    row("LE", "Camioneta Automática Especial"),
    row("LU", "SUV Híbrida Libre"),
  ],
};

describe("resolveGamaCode — bare gama code → quoted row", () => {
  it("resolves the reported case: a lone code, any casing", () => {
    expect(resolveGamaCode("Cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("CX", TABLE)).toBe("CX");
  });

  it("resolves a code framed by a determiner / choice word", () => {
    expect(resolveGamaCode("la cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("quiero la cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("gama cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("me quedo con la cx", TABLE)).toBe("CX");
    expect(resolveGamaCode("dame la gc por favor", TABLE)).toBe("GC");
    expect(resolveGamaCode("el g4", TABLE)).toBe("G4");
  });

  it("resolves single-letter codes only when framed or standalone", () => {
    expect(resolveGamaCode("c", TABLE)).toBe("C");
    expect(resolveGamaCode("la c", TABLE)).toBe("C");
    expect(resolveGamaCode("quiero la f", TABLE)).toBe("F");
  });

  it("does NOT false-positive on common words that contain a code", () => {
    expect(resolveGamaCode("le doy mis datos", TABLE)).toBeNull(); // not LE
    expect(resolveGamaCode("la cotización está bien", TABLE)).toBeNull(); // not C
    expect(resolveGamaCode("lo voy a pensar", TABLE)).toBeNull(); // not LU
    expect(resolveGamaCode("con efectivo", TABLE)).toBeNull(); // not C
    expect(resolveGamaCode("para el aeropuerto", TABLE)).toBeNull();
    expect(resolveGamaCode("hola buenas tardes", TABLE)).toBeNull();
  });

  it("returns null when the message names two different codes (ambiguous)", () => {
    expect(resolveGamaCode("entre la c y la cx no sé", TABLE)).toBeNull();
  });

  it("returns null for a code that isn't in the shown quote", () => {
    expect(resolveGamaCode("la fl", TABLE)).toBeNull(); // FL not quoted here
    expect(resolveGamaCode("gama e", TABLE)).toBeNull(); // phantom 'E'
  });
});
