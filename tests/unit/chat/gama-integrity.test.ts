import { describe, it, expect } from "vitest";
import {
  explicitGamaCode,
  hourChangePriceLine,
} from "@/lib/chat/orchestrator/blocks";
import type { QuoteTable } from "@/lib/chat/orchestrator/quote-service";

/** Pure tests for the R1 gama-integrity helpers. */

const row = (categoria: string, descripcion: string, precioTotal: number) => ({
  categoria,
  descripcion,
  dias: 5,
  precioTotal,
  precioHoraExtra: 0,
  horasExtra: 0,
  quote: `blob-${categoria}`,
});

const table: QuoteTable = {
  sede: "AAKAL",
  dias: 5,
  filas: [
    row("C", "Gama C Económico Mecánico", 869480),
    row("F", "Gama F Sedán Mecánico", 959481),
    row("GC", "Gama GC Camioneta Automática", 1571071),
  ],
};

describe("explicitGamaCode", () => {
  it("returns the code the customer named explicitly by 'gama X'", () => {
    expect(explicitGamaCode("me gusta la gama c", table)).toBe("C");
    expect(explicitGamaCode("quiero la gama gc", table)).toBe("GC");
    expect(explicitGamaCode("GAMA F por favor", table)).toBe("F");
  });

  it("returns null when no valid 'gama X' is named", () => {
    expect(explicitGamaCode("la gama z no existe", table)).toBeNull();
    expect(explicitGamaCode("cuánto cuesta", table)).toBeNull();
    // A bare "la c" is intentionally NOT matched (ambiguous, false positives).
    expect(explicitGamaCode("dame la c", table)).toBeNull();
  });

  it("takes the LAST explicit mention within the message", () => {
    expect(explicitGamaCode("no la gama f, mejor la gama c", table)).toBe("C");
  });
});

describe("hourChangePriceLine", () => {
  it("explains the new day-count and total for the kept gama", () => {
    const line = hourChangePriceLine(table.filas[0], 6);
    expect(line).toContain("6 días");
    expect(line).toContain("Gama C");
    expect(line).toContain("$869.480");
  });
});
