import { describe, it, expect } from "vitest";

import {
  quoteTableData,
  bookingSummaryBlock,
} from "@/lib/chat/orchestrator/blocks";
import type { QuoteTable } from "@/lib/chat/orchestrator/quote-service";
import type { ConversationState } from "@/lib/chat/orchestrator/slots";

function row(categoria: string, descripcion: string) {
  return {
    categoria,
    descripcion,
    dias: 4,
    precioTotal: 700000,
    precioHoraExtra: 0,
    horasExtra: 0,
    quote: `blob-${categoria}`,
  };
}

const TABLE: QuoteTable = {
  sede: "AAKAL",
  dias: 4,
  filas: [
    row("C", "Gama C Económico Mecánico"),
    row("GC", "Gama GC Camioneta Automática"),
    row("F", "Sedán Mecánico"), // already without the "Gama X" prefix
    row("LE", "LE"), // quote-service fallback: descripcion === categoria
  ],
};

describe("quoteTableData — strips the redundant 'Gama X' prefix (display only)", () => {
  it("drops the 'Gama <code>' the provider prepends so the card doesn't echo it", () => {
    const part = quoteTableData(TABLE);
    const byCode = Object.fromEntries(
      part.filas.map((f) => [f.categoria, f.descripcion]),
    );
    expect(byCode.C).toBe("Económico Mecánico");
    expect(byCode.GC).toBe("Camioneta Automática");
  });

  it("leaves a descripción without the prefix untouched", () => {
    const part = quoteTableData(TABLE);
    const f = part.filas.find((x) => x.categoria === "F");
    expect(f?.descripcion).toBe("Sedán Mecánico");
  });

  it("keeps the fallback (descripcion === categoria) intact, never empty", () => {
    const part = quoteTableData(TABLE);
    const le = part.filas.find((x) => x.categoria === "LE");
    expect(le?.descripcion).toBe("LE");
  });

  it("does not mutate the internal QuoteRow.descripcion", () => {
    quoteTableData(TABLE);
    expect(TABLE.filas[0].descripcion).toBe("Gama C Económico Mecánico");
  });
});

describe("bookingSummaryBlock — unaffected by the display strip (no regression)", () => {
  it("still uses the full 'Gama X …' internal descripción verbatim", () => {
    const state = {
      phase: "confirming",
      slots: {
        ciudad: "cali",
        gama_elegida: "C",
        cliente: {},
      },
      lastQuote: TABLE,
      flags: {},
    } as unknown as ConversationState;
    const summary = bookingSummaryBlock(state);
    // The summary frames it as "tu Gama C Económico Mecánico" — proof the internal
    // descripción (with prefix) is the source of truth, not the stripped display one.
    expect(summary).toContain("tu Gama C Económico Mecánico");
  });
});
