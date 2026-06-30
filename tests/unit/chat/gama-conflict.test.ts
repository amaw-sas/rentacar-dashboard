import { describe, it, expect } from "vitest";
import { gamaConflictNote } from "@/lib/chat/orchestrator/blocks";
import type { QuoteRow } from "@/lib/chat/orchestrator/quote-service";

const row = (descripcion: string): QuoteRow => ({
  categoria: "X",
  descripcion,
  dias: 3,
  precioTotal: 300000,
  precioHoraExtra: 0,
  horasExtra: 0,
  quote: "blob",
});

describe("gamaConflictNote — safety net before booking the wrong product", () => {
  it("flags a transmission mismatch", () => {
    expect(gamaConflictNote(row("Económico Mecánico"), "automatico")).toContain(
      "automática",
    );
    expect(gamaConflictNote(row("Sedán Automático"), "mecanico")).toContain(
      "mecánica",
    );
  });

  it("flags a vehicle-class mismatch", () => {
    expect(
      gamaConflictNote(row("Económico Mecánico"), undefined, "camioneta"),
    ).toContain("camioneta");
    expect(
      gamaConflictNote(row("SUV Automática"), undefined, "auto"),
    ).toContain("auto");
  });

  it("stays silent when the gama matches the stated preference (or nothing stated)", () => {
    expect(gamaConflictNote(row("Económico Mecánico"), "mecanico")).toBeNull();
    expect(
      gamaConflictNote(row("SUV Automática"), "automatico", "camioneta"),
    ).toBeNull();
    expect(gamaConflictNote(row("Económico Mecánico"))).toBeNull();
  });
});
