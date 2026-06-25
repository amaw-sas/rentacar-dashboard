import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM-bearing and DB-bearing collaborators so the orchestrator's
// deterministic control flow is tested in isolation. blocks.ts and slots.ts run
// for real (pure).
const { extractSlots } = vi.hoisted(() => ({ extractSlots: vi.fn() }));
vi.mock("@/lib/chat/orchestrator/extract", () => ({ extractSlots }));

// Mock only getQuoteTable; keep the real (pure) findGama the booking phase uses.
const { getQuoteTable } = vi.hoisted(() => ({ getQuoteTable: vi.fn() }));
vi.mock("@/lib/chat/orchestrator/quote-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chat/orchestrator/quote-service")>();
  return { ...actual, getQuoteTable };
});

// The booking side effect is the shared core; mock it to drive the close branches.
const { executeBooking } = vi.hoisted(() => ({ executeBooking: vi.fn() }));
vi.mock("@/lib/chat/booking-core", () => ({ executeBooking }));

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
  executeBooking.mockReset();
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

// ---------------------------------------------------------------------------
// Booking phase machine (Etapa 3): choosing_gama → collecting_customer →
// confirming → booked. Code owns the close; executeBooking is mocked.
// ---------------------------------------------------------------------------

const QUOTE_TABLE = {
  sede: "AABOG01",
  dias: 3,
  filas: [
    {
      categoria: "C",
      descripcion: "Económico",
      dias: 3,
      precioTotal: 300000,
      horasExtra: 0,
      precioHoraExtra: 0,
      quote: "blob-c",
    },
    {
      categoria: "F",
      descripcion: "SUV",
      dias: 3,
      precioTotal: 500000,
      horasExtra: 0,
      precioHoraExtra: 0,
      quote: "blob-f",
    },
  ],
};

const FULL_CLIENTE = {
  fullname: "Diego Melo",
  identification_type: "CC",
  identification: "1234567890",
  email: "diego@correo.com",
  phone: "3001234567",
};

/** A state that already has a shown quote (post-cotización), parametrized by phase. */
function quotedState(over: Partial<ConversationState> = {}): ConversationState {
  return {
    phase: "quoted",
    slots: {
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-04",
      cliente: {},
      ...over.slots,
    },
    lastQuote: QUOTE_TABLE,
    flags: {
      greeted: true,
      requisitos_shown: true,
      quote_shown: true,
      last_quote_signature: "bogota||2026-07-01|2026-07-04||",
      summary_shown: false,
      ...over.flags,
    },
    ...(over.phase ? { phase: over.phase } : {}),
  };
}

const lastSaved = () =>
  saveConversationState.mock.calls[
    saveConversationState.mock.calls.length - 1
  ][1] as ConversationState;

describe("orchestrator runTurn — booking phase", () => {
  it("(a) after a quote, choosing a gama does NOT re-quote and asks for customer data", async () => {
    extractSlots.mockResolvedValue({
      intent: "elige_gama",
      updates: { gama_elegida: "C" },
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "la C",
      recentContext: [],
      now: NOW,
    });

    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(textOf(chunks).toLowerCase()).toContain("nombre completo");
    expect(lastSaved().phase).toBe("collecting_customer");
  });

  it("(b) once data is valid, emits the summary ONCE and never repeats it", async () => {
    // Turn 1: the last two fields arrive → validate → confirming + summary.
    extractSlots.mockResolvedValue({
      intent: "da_datos",
      updates: { cliente: { email: "diego@correo.com", phone: "3001234567" } },
    });
    const turn1 = fakeWriter();
    await runTurn(turn1.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "collecting_customer",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: {
            fullname: "Diego Melo",
            identification_type: "CC",
            identification: "1234567890",
          },
        },
      }),
      userMessage: "diego@correo.com, 3001234567",
      recentContext: [],
      now: NOW,
    });
    expect(textOf(turn1.chunks)).toContain("Para cerrar");
    const afterSummary = lastSaved();
    expect(afterSummary.phase).toBe("confirming");
    expect(afterSummary.flags.summary_shown).toBe(true);

    // Turn 2: a side question → free-form answer, NO summary repeat.
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: afterSummary,
      userMessage: "¿incluye seguro?",
      recentContext: [],
      now: NOW,
    });
    expect(textOf(turn2.chunks)).not.toContain("Para cerrar");
  });

  it("(c) in confirming, 'sí' books once; a second 'sí' after booked does NOT re-book", async () => {
    executeBooking.mockResolvedValue({
      kind: "ok",
      data: { numero_solicitud: "AVX9" },
    });
    const confirming = quotedState({
      phase: "confirming",
      slots: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        gama_elegida: "C",
        cliente: FULL_CLIENTE,
      },
      flags: {
        greeted: true,
        requisitos_shown: true,
        quote_shown: true,
        last_quote_signature: "bogota||2026-07-01|2026-07-04||",
        summary_shown: true,
      },
    });

    // Turn 1: confirm → book once with the chosen gama's quote.
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const turn1 = fakeWriter();
    await runTurn(turn1.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: confirming,
      userMessage: "sí, confirmo",
      recentContext: [],
      now: NOW,
    });
    expect(executeBooking).toHaveBeenCalledOnce();
    expect(executeBooking).toHaveBeenCalledWith(
      expect.objectContaining({ quote: "blob-c" }),
    );
    expect(textOf(turn1.chunks)).toContain("AVX9");
    const booked = lastSaved();
    expect(booked.phase).toBe("booked");

    // Turn 2: another "sí" while booked → the second sí is impossible.
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: booked,
      userMessage: "sí",
      recentContext: [],
      now: NOW,
    });
    expect(executeBooking).toHaveBeenCalledOnce(); // still once
  });

  it("(d) a failed booking with links emits the data-buttons part", async () => {
    executeBooking.mockResolvedValue({
      kind: "failed",
      message: "No se pudo crear la reserva.",
      links: { webUrl: "https://web/finish", whatsappUrl: "https://wa.me/57x" },
    });
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "confirming",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: FULL_CLIENTE,
        },
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          summary_shown: true,
        },
      }),
      userMessage: "dale",
      recentContext: [],
      now: NOW,
    });

    const buttons = dataParts(chunks, "data-buttons");
    expect(buttons).toHaveLength(1);
    expect((buttons[0].data as { web?: string }).web).toBe("https://web/finish");
  });
});
