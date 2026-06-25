import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM-bearing and DB-bearing collaborators so the orchestrator's
// deterministic control flow is tested in isolation. blocks.ts and slots.ts run
// for real (pure).
const { extractSlots } = vi.hoisted(() => ({ extractSlots: vi.fn() }));
vi.mock("@/lib/chat/orchestrator/extract", () => ({ extractSlots }));

const { getQuoteTable } = vi.hoisted(() => ({ getQuoteTable: vi.fn() }));
vi.mock("@/lib/chat/orchestrator/quote-service", () => ({ getQuoteTable }));

const { freeFormConfig } = vi.hoisted(() => ({
  freeFormConfig: vi.fn(async () => ({})),
}));
vi.mock("@/lib/chat/orchestrator/prompts", () => ({ freeFormConfig }));

const { saveConversationState } = vi.hoisted(() => ({
  saveConversationState: vi.fn(),
}));
vi.mock("@/lib/chat/persistence", () => ({ saveConversationState }));

const { streamText } = vi.hoisted(() => ({
  streamText: vi.fn(() => ({ toUIMessageStream: () => new ReadableStream() })),
}));
vi.mock("ai", () => ({ streamText }));

import { runTurn } from "@/lib/chat/orchestrator";
import { initialState, type ConversationState } from "@/lib/chat/orchestrator/slots";

interface Chunk {
  type?: string;
  id?: string;
  delta?: string;
  data?: unknown;
}
function fakeWriter() {
  const chunks: Chunk[] = [];
  return {
    chunks,
    writer: {
      write: (p: Chunk) => chunks.push(p),
      merge: () => {},
      onError: undefined,
    },
  };
}
/** Concatenated text deltas (what the user sees as the bubble). */
const textOf = (chunks: Chunk[]) =>
  chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.delta)
    .join("\n");
const dataParts = (chunks: Chunk[], type: string) =>
  chunks.filter((c) => c.type === type);

beforeEach(() => {
  extractSlots.mockReset();
  getQuoteTable.mockReset();
  saveConversationState.mockReset();
  freeFormConfig.mockClear();
  streamText.mockClear();
});

const NOW = new Date("2026-06-25T20:00:00Z");

describe("orchestrator runTurn", () => {
  it("greets once and asks for the city deterministically", async () => {
    extractSlots.mockResolvedValue({ intent: "saludo", updates: {} });
    const { chunks, writer } = fakeWriter();

    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: initialState(),
      userMessage: "hola",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text).toContain("Soy Valeria");
    expect(text.toLowerCase()).toContain("ciudad");
    // greeting exactly once
    expect((text.match(/Soy Valeria/g) ?? []).length).toBe(1);
    // state saved with greeted=true
    const saved = saveConversationState.mock.calls[0][1] as ConversationState;
    expect(saved.flags.greeted).toBe(true);
  });

  it("emits requisitos once + a code quote table when slots are complete", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
      },
    });
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG01",
        dias: 3,
        filas: [
          {
            categoria: "C",
            descripcion: "Económico",
            precioTotal: 300000,
            horasExtra: 0,
            precioHoraExtra: 0,
            quote: "blob-c",
          },
        ],
      },
    });

    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "bogota del 1 al 4 de julio",
      recentContext: [],
      now: NOW,
    });

    expect(textOf(chunks)).toContain("NUESTROS REQUISITOS");
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(1);
    // No greeting re-emitted (already greeted).
    expect(textOf(chunks)).not.toContain("Soy Valeria");
    const saved = saveConversationState.mock.calls[0][1] as ConversationState;
    expect(saved.flags.quote_shown).toBe(true);
    expect(saved.phase).toBe("quoted");
    expect(saved.lastQuote?.filas[0].categoria).toBe("C");
  });

  it("does NOT re-emit greeting/requisitos/quote on a follow-up tangential turn", async () => {
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const afterQuote: ConversationState = {
      phase: "quoted",
      slots: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        cliente: {},
      },
      flags: {
        greeted: true,
        requisitos_shown: true,
        quote_shown: true,
        last_quote_signature: "bogota||2026-07-01|2026-07-04||",
      },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: afterQuote,
      userMessage: "¿tienen fotos?",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text).not.toContain("Soy Valeria"); // no re-greet
    expect(text).not.toContain("NUESTROS REQUISITOS"); // no re-requisitos
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0); // no re-quote
    expect(getQuoteTable).not.toHaveBeenCalled();
    // Free-form path used instead.
    expect(streamText).toHaveBeenCalledOnce();
  });
});
