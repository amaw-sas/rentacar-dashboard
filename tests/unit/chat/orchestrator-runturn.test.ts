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
  streamText: vi.fn(() => ({
    // freeForm() streams via toUIMessageStream; freeFormText() awaits .text.
    toUIMessageStream: () => new ReadableStream(),
    text: Promise.resolve(""),
  })),
}));
vi.mock("ai", () => ({ streamText }));

// Etapa 4 on-demand collaborators: mock the DB-bearing card lookup and the link
// builder so the orchestrator's on-demand control flow is tested in isolation.
const { getGamaCards } = vi.hoisted(() => ({ getGamaCards: vi.fn() }));
vi.mock("@/lib/chat/orchestrator/gama-cards", () => ({ getGamaCards }));

const { buildOnDemandLinks } = vi.hoisted(() => ({ buildOnDemandLinks: vi.fn() }));
vi.mock("@/lib/chat/reserva-link", () => ({ buildOnDemandLinks }));

const { getLocationDirectory } = vi.hoisted(() => ({
  getLocationDirectory: vi.fn(async () => []),
}));
vi.mock("@/lib/api/location-directory", () => ({ getLocationDirectory }));

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
  getGamaCards.mockReset();
  buildOnDemandLinks.mockReset();
  getLocationDirectory.mockClear();
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

    // Turn 2: another "sí" while booked → the second sí is impossible AND the bot
    // acknowledges deterministically (no free-form re-opening the funnel).
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    streamText.mockClear();
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: booked,
      userMessage: "sí",
      recentContext: [],
      now: NOW,
    });
    expect(executeBooking).toHaveBeenCalledOnce(); // still once — no double-book
    expect(streamText).not.toHaveBeenCalled(); // no free-form re-prompt
    expect(textOf(turn2.chunks)).toContain("ya quedó confirmada");
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

// ---------------------------------------------------------------------------
// On-demand handling (Etapa 4): vehicle cards, reservation link, advisor WhatsApp.
// Code-owned; getGamaCards/buildOnDemandLinks/getLocationDirectory are mocked.
// ---------------------------------------------------------------------------

describe("orchestrator runTurn — on-demand (Etapa 4)", () => {
  it("(e) 'muéstrame los modelos de la gama F' with a quote emits data-gamaCards and does NOT re-quote/book", async () => {
    getGamaCards.mockResolvedValue({
      gama: "F",
      descripcion: "SUV",
      modelos: [{ nombre: "Renault Duster", imagen: "https://img/duster.png" }],
    });
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      // gama named in the message, not yet chosen as a slot.
      state: quotedState(),
      userMessage: "muéstrame los modelos de la gama F",
      recentContext: [],
      now: NOW,
    });

    expect(getGamaCards).toHaveBeenCalledWith("F", "SUV");
    expect(dataParts(chunks, "data-gamaCards")).toHaveLength(1);
    // No re-quote, no booking.
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(executeBooking).not.toHaveBeenCalled();
    // Phase untouched (still quoted).
    expect(lastSaved().phase).toBe("quoted");
  });

  it("(f) pedir_enlace with a chosen gama emits data-buttons with the web link only", async () => {
    buildOnDemandLinks.mockReturnValue({
      webUrl: "https://web/reserva",
      whatsappUrl: "https://wa.me/57x?text=hola",
    });
    extractSlots.mockResolvedValue({ intent: "pedir_enlace", updates: {} });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "collecting_customer",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: { fullname: "Diego Melo" },
        },
      }),
      userMessage: "¿me pasas el link para reservar yo mismo?",
      recentContext: [],
      now: NOW,
    });

    expect(buildOnDemandLinks).toHaveBeenCalledOnce();
    const buttons = dataParts(chunks, "data-buttons");
    expect(buttons).toHaveLength(1);
    expect((buttons[0].data as { web?: string }).web).toBe("https://web/reserva");
    expect((buttons[0].data as { whatsapp?: string }).whatsapp).toBeUndefined();
    // No re-book; mid-funnel re-prompt re-asks the pending customer field.
    expect(executeBooking).not.toHaveBeenCalled();
    expect(lastSaved().phase).toBe("collecting_customer");
  });

  it("(h) a tangential question while choosing a gama nudges SHORT, never re-pasting the gama list", async () => {
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "¿incluye seguro?",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(streamText).toHaveBeenCalledOnce(); // free-form answered the side question
    expect(text).toContain("¿Con cuál gama te quedas?"); // short nudge
    expect(text).not.toContain("Tenemos:"); // NOT the 10-gama re-paste (the repetition bug)
    expect(text).not.toContain("Gama F"); // no gama codes re-listed in prose
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(lastSaved().phase).toBe("choosing_gama");
  });

  it("(i) pregunta_horas_extra re-quotes +1h and answers a REAL per-gama figure (no re-list)", async () => {
    extractSlots.mockResolvedValue({ intent: "pregunta_horas_extra", updates: {} });
    // Localiza bills extra hours proportionally in the 2–4h band; the re-quote at
    // pickup+3h returns horasExtra=3 with the total, from which we derive the per-hour.
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG01",
        dias: 3,
        filas: [
          {
            categoria: "C",
            descripcion: "Económico",
            dias: 3,
            precioTotal: 312000,
            horasExtra: 3,
            precioHoraExtra: 12000,
            quote: "blob-c",
          },
        ],
      },
    });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "¿cuánto vale la hora extra?",
      recentContext: [],
      now: NOW,
    });

    // Re-quoted the SAME city/dates with the return bumped into the billable band
    // (pickup 10:00 + 3h = 13:00) so Localiza returns a non-zero precio_hora_extra.
    expect(getQuoteTable).toHaveBeenCalledWith(
      expect.objectContaining({
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        hora_recogida: "10:00",
        hora_devolucion: "13:00",
      }),
    );
    const text = textOf(chunks);
    expect(text).toContain("Gama C");
    expect(text).toContain("$4.000"); // per-hour = 12000 / 3 extra hours, whole COP
    expect(text).not.toContain("Tenemos:"); // no re-paste
    // It is a read: no quote table re-emitted, no booking, phase untouched.
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(executeBooking).not.toHaveBeenCalled();
    expect(lastSaved().phase).toBe("quoted");
  });

  it("(j) pregunta_horas_extra falls back to free-form policy when the re-quote can't price it", async () => {
    extractSlots.mockResolvedValue({ intent: "pregunta_horas_extra", updates: {} });
    getQuoteTable.mockResolvedValue({ ok: false, message: "sin disponibilidad" });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "¿cuánto vale la hora extra?",
      recentContext: [],
      now: NOW,
    });

    expect(getQuoteTable).toHaveBeenCalledOnce();
    // No invented figure; the free-form reply (policy) handles it, plus a short nudge.
    expect(streamText).toHaveBeenCalledOnce();
    expect(textOf(chunks)).not.toContain("hora extra cuesta");
    expect(textOf(chunks)).toContain("¿Con cuál gama te quedas?");
  });

  it("(k) drops an invalid/phantom gama_elegida so the funnel does NOT skip to data collection", async () => {
    // The extractor hallucinated "E" (from "económico") — not a real quoted gama.
    extractSlots.mockResolvedValue({
      intent: "tangencial",
      updates: { gama_elegida: "E" },
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "y eso incluye seguro",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text.toLowerCase()).not.toContain("nombre completo"); // did NOT skip the funnel
    expect(text).toContain("¿Con cuál gama te quedas?"); // stayed in the choice
    // The phantom pick is scrubbed from persisted state.
    expect(lastSaved().slots.gama_elegida).toBeUndefined();
    expect(lastSaved().phase).toBe("choosing_gama");
  });

  it("(l) when a gama pick also carries a question, answers it BEFORE asking for data", async () => {
    extractSlots.mockResolvedValue({
      intent: "elige_gama",
      updates: { gama_elegida: "C" },
    });
    streamText.mockReturnValueOnce({
      toUIMessageStream: () => new ReadableStream(),
      text: Promise.resolve("Sí, hay una sede cerca del aeropuerto."),
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "me quedo con la C, ¿hay sede cerca del aeropuerto?",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text).toContain("hay una sede cerca del aeropuerto"); // answered the side question
    expect(text.toLowerCase()).toContain("nombre completo"); // and progressed
    // Order: answer first, then the data question.
    expect(text.indexOf("sede cerca")).toBeLessThan(text.toLowerCase().indexOf("nombre completo"));
    expect(lastSaved().phase).toBe("collecting_customer");
  });

  it("(g) hablar_asesor without a quote emits a neutral advisor wa.me", async () => {
    extractSlots.mockResolvedValue({ intent: "hablar_asesor", updates: {} });

    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "quiero hablar con un asesor",
      recentContext: [],
      now: NOW,
    });

    expect(buildOnDemandLinks).not.toHaveBeenCalled();
    const buttons = dataParts(chunks, "data-buttons");
    expect(buttons).toHaveLength(1);
    const wa = (buttons[0].data as { whatsapp?: string }).whatsapp ?? "";
    expect(wa.startsWith("https://wa.me/573016729250?text=")).toBe(true);
    expect((buttons[0].data as { web?: string }).web).toBeUndefined();
  });
});
