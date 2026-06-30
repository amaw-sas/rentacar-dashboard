import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { buildOnDemandLinks, buildSelfServeLinks } = vi.hoisted(() => ({
  buildOnDemandLinks: vi.fn(),
  buildSelfServeLinks: vi.fn(),
}));
vi.mock("@/lib/chat/reserva-link", () => ({
  buildOnDemandLinks,
  buildSelfServeLinks,
}));

const { getLocationDirectory } = vi.hoisted(() => ({
  getLocationDirectory: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("@/lib/api/location-directory", () => ({ getLocationDirectory }));

const { runTarifaMensual, runInfoSedes } = vi.hoisted(() => ({
  runTarifaMensual: vi.fn(),
  runInfoSedes: vi.fn(),
}));
vi.mock("@/lib/chat/knowledge-tools", () => ({ runTarifaMensual, runInfoSedes }));

import { runTurn, looksLikeQuestion } from "@/lib/chat/orchestrator";
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
    // Social-proof recommendation: the cheapest car (Gama C) is named as the most-chosen.
    expect(textOf(chunks)).toContain("más eligen nuestros clientes");
    expect(textOf(chunks)).toContain("Gama C");
    // Honest decision nudge on the close (real availability volatility, no fake scarcity).
    expect(textOf(chunks)).toContain("te asegura este precio y el cupo");
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

  it("off-funnel STREAMING free-form does NOT prepend the bogus 'se me trabó'", async () => {
    // Regression (introduced with the resilience safety net): the net used blockId,
    // which the streaming free-form (writer.merge) bypasses — so EVERY off-funnel reply
    // before a quote got a spurious 'Disculpa, se me trabó…' before the real answer.
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const greeted: ConversationState = {
      phase: "collecting",
      slots: { cliente: {} },
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "¿el depósito puede ser en efectivo?",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalledOnce(); // streaming free-form answered
    expect(textOf(chunks)).not.toContain("se me trabó"); // no bogus fallback prepended
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
function quotedState(
  over: Partial<Omit<ConversationState, "flags">> & {
    flags?: Partial<ConversationState["flags"]>;
  } = {},
): ConversationState {
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
    // Low-friction + endowment framing on the first data question.
    expect(textOf(chunks)).toContain("aseguramos tu reserva");
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
    // Persuasion close: per-day reframe (300.000 / 3 = 100.000), loss-aversion, endowment CTA.
    expect(textOf(turn1.chunks)).toContain("$100.000/día");
    expect(textOf(turn1.chunks)).toContain("aseguras este valor y el cupo");
    expect(textOf(turn1.chunks)).toContain("¿Confirmo tu reserva?");
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
      expect.anything(), // now (threaded for replay date override)
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

  it("(m) a sede-only change with SAME prices refreshes silently and keeps the funnel — no table re-paste", async () => {
    // Customer already chose gama C; now they pick a sede. Picking a sede changes the
    // quote signature, but ciudad/fechas are the same and the prices come back identical,
    // so the table must NOT be re-pasted — the funnel just advances to customer data.
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { sede: "aeropuerto" },
    });
    getQuoteTable.mockResolvedValue({ ok: true, table: QUOTE_TABLE });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: {},
        },
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
          summary_shown: false,
        },
      }),
      userMessage: "aeropuerto",
      recentContext: [],
      now: NOW,
    });

    // Refreshed silently (one re-quote), but the table is NOT re-emitted.
    expect(getQuoteTable).toHaveBeenCalledOnce();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    // The funnel advanced to collecting customer data with the chosen gama intact.
    expect(textOf(chunks).toLowerCase()).toContain("nombre completo");
    const saved = lastSaved();
    expect(saved.phase).toBe("collecting_customer");
    expect(saved.slots.sede).toBe("aeropuerto");
  });

  it("(n) a sede-only change with DIFFERENT prices re-shows the table (it is new info)", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { sede: "centro" },
    });
    // Same gamas, different totals for this sede → genuinely new info.
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG02",
        dias: 3,
        filas: [
          { categoria: "C", descripcion: "Económico", dias: 3, precioTotal: 320000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-c2" },
          { categoria: "F", descripcion: "SUV", dias: 3, precioTotal: 500000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-f2" },
        ],
      },
    });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: {},
        },
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
          summary_shown: false,
        },
      }),
      userMessage: "centro",
      recentContext: [],
      now: NOW,
    });

    expect(getQuoteTable).toHaveBeenCalledOnce();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(1);
    const saved = lastSaved();
    expect(saved.phase).toBe("quoted");
    // The prior gama pick is cleared so the customer re-confirms against the NEW prices
    // instead of being silently locked into C at the higher total.
    expect(saved.slots.gama_elegida).toBeUndefined();
  });

  it("(o) after BOOKED, new contact data does NOT re-quote — it routes to a real advisor", async () => {
    extractSlots.mockResolvedValue({
      intent: "da_datos",
      updates: { cliente: { email: "nuevo@correo.com" } },
    });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "booked",
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
      userMessage: "delavegadiego91@gmail.com",
      recentContext: [],
      now: NOW,
    });

    // No re-quote, no re-book. Honest copy (no false "te reenvío") + a real advisor button.
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(executeBooking).not.toHaveBeenCalled();
    const text = textOf(chunks);
    expect(text).toContain("ya quedó confirmada");
    expect(text).not.toContain("Te reenvío"); // never promises a resend the code can't do
    const buttons = dataParts(chunks, "data-buttons");
    expect(buttons).toHaveLength(1);
    const wa = (buttons[0].data as { whatsapp?: string }).whatsapp ?? "";
    expect(wa.startsWith("https://wa.me/")).toBe(true);
    expect(lastSaved().phase).toBe("booked");
  });

  it("(p) a BOOKED customer who changes a price-driver is NOT re-quoted (terminal phase)", async () => {
    // The post-confirmation re-quote bug: a booked customer asks 'y si la devuelvo el 5?'.
    // canQuote is still true, so without the booked guard this would re-quote and reset the
    // funnel. It must stay booked and hand the question to the guided free-form instead.
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { fecha_devolucion: "2026-07-05" },
    });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "booked",
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
          last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
          summary_shown: true,
        },
      }),
      userMessage: "¿y si la devuelvo el 5?",
      recentContext: [],
      now: NOW,
    });

    // No re-quote, no table re-paste, no re-book — the reservation stays terminal.
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(lastSaved().phase).toBe("booked");
  });

  it("(q) asking for MORE THAN ONE vehicle shows the one-per-reservation notice ONCE", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        cantidad: 2,
      },
    });
    getQuoteTable.mockResolvedValue({ ok: true, table: QUOTE_TABLE });

    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const turn1 = fakeWriter();
    await runTurn(turn1.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "necesito 2 carros en bogota del 1 al 4 de julio",
      recentContext: [],
      now: NOW,
    });

    expect(textOf(turn1.chunks)).toContain("responsable"); // the per-vehicle notice
    expect(dataParts(turn1.chunks, "data-quoteTable")).toHaveLength(1); // still quotes one
    const saved1 = lastSaved();
    expect(saved1.flags.multi_vehicle_notice_shown).toBe(true);
    expect(saved1.slots.cantidad).toBe(2);

    // Turn 2: the notice is NOT repeated (flag guards it).
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: saved1,
      userMessage: "¿incluye seguro?",
      recentContext: [],
      now: NOW,
    });
    expect(textOf(turn2.chunks)).not.toContain("un vehículo");
  });

  it("(r) pedir_enlace that ALSO names a sede still sends the link (not swallowed by the sede refresh)", async () => {
    buildOnDemandLinks.mockReturnValue({
      webUrl: "https://web/reserva",
      whatsappUrl: "https://wa.me/57x?text=hola",
    });
    // Same message carries the link request AND a sede change.
    extractSlots.mockResolvedValue({
      intent: "pedir_enlace",
      updates: { sede: "aeropuerto" },
    });

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
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
          summary_shown: false,
        },
      }),
      userMessage: "mándame el enlace para reservar en el aeropuerto",
      recentContext: [],
      now: NOW,
    });

    // The explicit link request is honored; the sede change does not pre-empt it.
    const buttons = dataParts(chunks, "data-buttons");
    expect(buttons).toHaveLength(1);
    expect((buttons[0].data as { web?: string }).web).toBe("https://web/reserva");
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
  });

  it("(s) a camioneta-only quote does NOT claim a 'most-chosen' gama (no false social proof)", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
      },
    });
    // An airport-style table: only camionetas/SUVs, no económico car.
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG-AIR",
        dias: 3,
        filas: [
          { categoria: "G4", descripcion: "Gama G4 Camioneta Mecánica 4X4", dias: 3, precioTotal: 2900000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-g4" },
          { categoria: "GY", descripcion: "Gama GY SUV Automática 7 puestos", dias: 3, precioTotal: 7000000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-gy" },
        ],
      },
    });

    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: true, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "bogota aeropuerto del 1 al 4",
      recentContext: [],
      now: NOW,
    });

    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(1);
    // No "most-chosen" claim when there is no económico car to honestly point to.
    expect(textOf(chunks)).not.toContain("más eligen nuestros clientes");
  });

  it("(t) a FAILED quote is not retried every turn — the next message reaches free-form", async () => {
    // Turn 1: a complete request whose quote fails (no availability).
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
      },
    });
    getQuoteTable.mockResolvedValue({
      ok: false,
      message: "Lo sentimos, No se encontraron vehículos disponibles.",
    });
    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: true, quote_shown: false },
    };
    const turn1 = fakeWriter();
    await runTurn(turn1.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "bogota del 1 al 4",
      recentContext: [],
      now: NOW,
    });
    expect(getQuoteTable).toHaveBeenCalledTimes(1);
    expect(textOf(turn1.chunks)).toContain("No se encontraron");
    const after = lastSaved();
    expect(after.flags.last_attempt_signature).toBeTruthy();

    // Turn 2: the customer sends another message (same params, e.g. their email). The bot
    // must NOT re-fire the same failing quote — the free-form answers instead.
    extractSlots.mockResolvedValue({
      intent: "da_datos",
      updates: { cliente: { email: "x@y.com" } },
    });
    streamText.mockClear();
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: after,
      userMessage: "x@y.com",
      recentContext: [],
      now: NOW,
    });
    expect(getQuoteTable).toHaveBeenCalledTimes(1); // NOT retried
    expect(streamText).toHaveBeenCalledOnce(); // free-form handled the follow-up
    expect(textOf(turn2.chunks)).not.toContain("No se encontraron");
  });

  it("(u) a question BEFORE a quote is answered first, then the next slot is asked", async () => {
    // City known, no dates yet. The extractor tags the price question as `cotizar`, so the
    // funnel would normally steamroll it with "¿qué fecha?" — now it answers first.
    extractSlots.mockResolvedValue({ intent: "cotizar", updates: {} });
    streamText.mockReturnValueOnce({
      toUIMessageStream: () => new ReadableStream(),
      text: Promise.resolve("Sí, el total ya incluye IVA, seguro básico y km ilimitado."),
    });
    const greeted: ConversationState = {
      phase: "collecting",
      slots: { ciudad: "bogota", cliente: {} },
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "¿el precio ya incluye IVA?",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(streamText).toHaveBeenCalledOnce(); // answered the question
    expect(text).toContain("ya incluye IVA");
    expect(text).toContain("Para qué fecha"); // and then asked the missing slot
    // Order: answer first, slot question after.
    expect(text.indexOf("incluye IVA")).toBeLessThan(text.indexOf("Para qué fecha"));
  });

  it("(w) a repeated unanswered slot question is VARIED, not asked verbatim again", async () => {
    const greeted: ConversationState = {
      phase: "collecting",
      slots: { cliente: {} },
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    // Turn 1: no city yet → the normal question, and we record we asked for "ciudad".
    extractSlots.mockResolvedValue({ intent: "saludo", updates: {} });
    const turn1 = fakeWriter();
    await runTurn(turn1.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "hola",
      recentContext: [],
      now: NOW,
    });
    expect(textOf(turn1.chunks)).toContain("¿En qué ciudad necesitas el carro?");
    const after = lastSaved();
    expect(after.flags.last_slot_asked).toBe("ciudad");

    // Turn 2: customer still doesn't give a city ("oye") → VARIED phrasing, not verbatim.
    extractSlots.mockResolvedValue({ intent: "saludo", updates: {} });
    const turn2 = fakeWriter();
    await runTurn(turn2.writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: after,
      userMessage: "oye",
      recentContext: [],
      now: NOW,
    });
    const text = textOf(turn2.chunks);
    expect(text).toContain("por ejemplo Bogotá"); // warmer, example-rich variant
    expect(text).not.toContain("¿En qué ciudad necesitas el carro?"); // not the verbatim repeat
  });

  it("(ae) the THIRD consecutive ask for a slot escalates (advisor offer), never verbatim", async () => {
    extractSlots.mockResolvedValue({ intent: "saludo", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: {
        phase: "greeting",
        slots: { cliente: {} },
        flags: {
          greeted: true,
          requisitos_shown: false,
          quote_shown: false,
          last_slot_asked: "ciudad",
          last_slot_ask_count: 2,
        },
      },
      userMessage: "mmm",
      recentContext: [],
      now: NOW,
    });
    const text = textOf(chunks);
    expect(text).toContain("asesor"); // escalates to an advisor offer
    expect(text).not.toContain("por ejemplo Bogotá"); // not the attempt-2 line
    expect(text).not.toContain("¿En qué ciudad necesitas el carro?"); // not verbatim
    expect(lastSaved().flags.last_slot_ask_count).toBe(3);
  });

  it("(x) changing only the HOUR refreshes silently — no full table re-paste", async () => {
    // Real chat (Pereira): the customer kept adjusting the pickup hour and the bot dumped the
    // whole table each time. Hours are no longer part of the core signature, so an hour-only
    // change is a MINOR change: refresh quietly, keep the funnel moving (price unchanged).
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { hora_recogida: "15:00", hora_devolucion: "15:00" },
    });
    getQuoteTable.mockResolvedValue({ ok: true, table: QUOTE_TABLE });

    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C",
          cliente: {},
        },
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
          summary_shown: false,
        },
      }),
      userMessage: "cambiemos la hora de recogida a las 3 de la tarde",
      recentContext: [],
      now: NOW,
    });

    expect(getQuoteTable).toHaveBeenCalledOnce(); // refreshed silently
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0); // NOT re-pasted
    expect(textOf(chunks).toLowerCase()).toContain("nombre completo"); // funnel advanced
    const saved = lastSaved();
    expect(saved.phase).toBe("collecting_customer");
    expect(saved.slots.hora_recogida).toBe("15:00");
  });

  it("(z) a buy signal with no gama chosen commits the recommended gama and progresses", async () => {
    // The Pereira/Manizales loop: customer says "reservemos" (confirma_reserva) while still in
    // choosing_gama with nothing committed. Instead of nudging again, commit the recommended
    // económico, echo it, and advance to data collection.
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          cliente: {},
        },
      }),
      userMessage: "reservemos entonces",
      recentContext: [],
      now: NOW,
    });
    const text = textOf(chunks);
    expect(text).toContain("seguimos con la **Gama C**"); // committed + echoed the recommended
    expect(text.toLowerCase()).toContain("nombre completo"); // and progressed to data
    const saved = lastSaved();
    expect(saved.slots.gama_elegida).toBe("C");
    expect(saved.phase).toBe("collecting_customer");
  });

  it("(ah) a buy signal does NOT commit a gama that violates the stated transmission", async () => {
    // The gama_mismatch defect: customer asked for automático; the recommended default (Gama C
    // económico) is mechanical. Don't book the wrong product — ask which gama instead.
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { transmision: "automatico", cliente: {} },
      }),
      userMessage: "resérvamelo",
      recentContext: [],
      now: NOW,
    });
    const saved = lastSaved();
    expect(saved.slots.gama_elegida).toBeUndefined(); // did NOT commit the mechanical Gama C
    expect(saved.phase).toBe("choosing_gama"); // asked instead
    expect(textOf(chunks)).toContain("¿Con cuál gama"); // showed the options
  });

  it("(ai) a buy signal with a camioneta request commits a camioneta gama, not the económico car", async () => {
    // Vehicle-class half of gama_mismatch: "camioneta para 5" must NOT default to Gama C económico.
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { tipo_vehiculo: "camioneta", cliente: {} },
      }),
      userMessage: "resérvamelo",
      recentContext: [],
      now: NOW,
    });
    const saved = lastSaved();
    expect(saved.slots.gama_elegida).toBe("F"); // the SUV/camioneta, not C económico
    expect(textOf(chunks)).toContain("Gama F");
  });

  it("(aj) 'el más económico' commits the económico gama instead of re-pasting the list", async () => {
    extractSlots.mockResolvedValue({ intent: "elige_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({ phase: "choosing_gama", slots: { cliente: {} } }),
      userMessage: "no mejor el más económico",
      recentContext: [],
      now: NOW,
    });
    const saved = lastSaved();
    expect(saved.slots.gama_elegida).toBe("C"); // resolved the label deterministically
    expect(saved.phase).toBe("collecting_customer");
    expect(textOf(chunks)).not.toContain("¿Con cuál gama seguimos?"); // not re-pasted
  });

  it("(aa) a disengaging message (goodbye / 'lo pienso') gets answered but NO gama nudge", async () => {
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "gracias, lo voy a pensar",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalledOnce(); // answered warmly
    expect(textOf(chunks)).not.toContain("¿Con cuál gama te quedas?"); // not nagged
  });

  it("(ab) the gama nudge stops after 2 (no more nagging)", async () => {
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-07-01|2026-07-04||",
          gama_nudge_count: 2,
        },
      }),
      userMessage: "¿y el seguro qué cubre?",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalledOnce();
    expect(textOf(chunks)).not.toContain("¿Con cuál gama te quedas?");
  });

  it("(ac) a raw provider error (XML/500) is replaced with a safe line, never leaked", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { ciudad: "bogota", fecha_recogida: "2026-07-01", fecha_devolucion: "2026-07-04" },
    });
    getQuoteTable.mockResolvedValue({
      ok: false,
      message: "<soap:Envelope><soap:Fault>500 Internal Error</soap:Fault></soap:Envelope>",
    });
    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: true, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "bogota del 1 al 4",
      recentContext: [],
      now: NOW,
    });
    const text = textOf(chunks);
    expect(text).toContain("No pude calcular el precio");
    expect(text.toLowerCase()).not.toContain("soap");
    expect(text).not.toContain("500");
  });

  it("(ad) a name mis-tagged as hablar_asesor does NOT emit the advisor button", async () => {
    // The extractor sometimes reads "Con Marco Lamas" (a name) as an advisor request.
    extractSlots.mockResolvedValue({ intent: "hablar_asesor", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "Con Marco Lamas",
      recentContext: [],
      now: NOW,
    });
    expect(dataParts(chunks, "data-buttons")).toHaveLength(0); // no advisor handoff
    expect(buildOnDemandLinks).not.toHaveBeenCalled();
  });

  it("(af) re-asking the same customer field escalates phrasing, never verbatim", async () => {
    extractSlots.mockResolvedValue({ intent: "da_datos", updates: {} }); // nothing usable parsed
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "collecting_customer",
        slots: { gama_elegida: "C", cliente: {} },
        flags: { last_customer_field_asked: "fullname", last_customer_field_ask_count: 1 },
      }),
      userMessage: "ajá",
      recentContext: [],
      now: NOW,
    });
    const text = textOf(chunks);
    expect(text).toContain("Solo me falta tu nombre completo"); // escalated variant
    expect(text).not.toContain("¿Tu nombre completo?"); // not the verbatim line
    expect(lastSaved().flags.last_customer_field_ask_count).toBe(2);
  });

  it("(ag) a question mid data-collection is answered before re-asking the field", async () => {
    extractSlots.mockResolvedValue({ intent: "cotizar", updates: {} }); // "¿cuánto el total?" mis-tagged
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "collecting_customer",
        slots: { gama_elegida: "C", cliente: {} },
      }),
      userMessage: "¿cuánto me sale el total?",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalledOnce(); // answered the question
    expect(textOf(chunks).toLowerCase()).toContain("nombre completo"); // then re-asked the gap
  });

  it("(ak) the free-form prompt carries the live quote prices so quoted == booked", async () => {
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "¿cuánto vale la gama F?",
      recentContext: [],
      now: NOW,
    });
    const calls = (
      streamText as unknown as { mock: { calls: Array<[{ prompt?: string }]> } }
    ).mock.calls;
    const prompt = calls.at(-1)?.[0]?.prompt ?? "";
    expect(prompt).toContain("Cotización vigente"); // live quote injected
    expect(prompt).toContain("Gama F"); // the actual quoted row (price from lastQuote, not re-cotized)
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

// ---------------------------------------------------------------------------
// Slot grounding (P0 · CHAT_SLOT_GROUNDING). Verifies the FSM WIRING of the pure
// grounding layer — the unit behavior of groundSlots lives in orchestrator-ground.test.ts.
// ---------------------------------------------------------------------------

const SERVED_DIRECTORY = [
  { slug: "bogota-aeropuerto", code: "BOG", city: "bogota", name: "Bogotá Aeropuerto", status: "active", pickup_address: "", pickup_map: "", schedule: {} },
  { slug: "palmira-centro", code: "PAL", city: "palmira", name: "Palmira Centro", status: "active", pickup_address: "", pickup_map: "", schedule: {} },
];

describe("orchestrator runTurn — slot grounding (CHAT_SLOT_GROUNDING)", () => {
  beforeEach(() => {
    process.env.CHAT_SLOT_GROUNDING = "on";
    getLocationDirectory.mockResolvedValue(SERVED_DIRECTORY);
  });
  afterEach(() => {
    delete process.env.CHAT_SLOT_GROUNDING;
  });

  it("(a) drops an unserved city, offers the served ones, and does NOT quote", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "Tuluá",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
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
      userMessage: "en Tuluá del 1 al 4",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text).toContain("no tenemos sede en Tuluá");
    expect(text).toContain("Palmira");
    expect(getQuoteTable).not.toHaveBeenCalled();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(lastSaved().slots.ciudad).toBeUndefined();
  });

  it("(c) warns about an unsupported vehicle ONCE, then still quotes the served city", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
      },
    });
    getQuoteTable.mockResolvedValue({ ok: true, table: QUOTE_TABLE });
    const greeted: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greeted,
      userMessage: "algo diésel en bogota del 1 al 4",
      recentContext: [],
      now: NOW,
    });

    expect(textOf(chunks)).toContain("no contamos con diésel");
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(1);
    expect(lastSaved().flags.unsupported_vehicle_notice_shown).toBe(true);
  });

  it("(d) gates the booking on hours: choosing a gama without hours asks for them", async () => {
    extractSlots.mockResolvedValue({
      intent: "elige_gama",
      updates: { gama_elegida: "C" },
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(), // no hours set
      userMessage: "la C",
      recentContext: [],
      now: NOW,
    });

    const text = textOf(chunks);
    expect(text.toLowerCase()).toContain("hora");
    expect(text.toLowerCase()).not.toContain("nombre completo");
    expect(lastSaved().phase).toBe("choosing_gama");
  });

  it("(d) lets the booking proceed once hours are present", async () => {
    extractSlots.mockResolvedValue({
      intent: "elige_gama",
      updates: { gama_elegida: "C" },
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          hora_recogida: "09:00",
          hora_devolucion: "09:00",
          cliente: {},
        },
        // Signature includes the hours so this isn't treated as a stale re-quote.
        flags: { last_quote_signature: "bogota||2026-07-01|2026-07-04|09:00|09:00" },
      }),
      userMessage: "la C",
      recentContext: [],
      now: NOW,
    });

    expect(textOf(chunks).toLowerCase()).toContain("nombre completo");
    expect(lastSaved().phase).toBe("collecting_customer");
  });
});

// ---------------------------------------------------------------------------
// Gama integrity (R1 · CHAT_GAMA_INTEGRITY): an explicit "gama X" choice overrides the LLM's
// resolution; an hour-only re-quote keeps the chosen gama instead of wiping it.
// ---------------------------------------------------------------------------

describe("orchestrator runTurn — gama integrity (CHAT_GAMA_INTEGRITY)", () => {
  beforeEach(() => {
    process.env.CHAT_GAMA_INTEGRITY = "on";
  });
  afterEach(() => {
    delete process.env.CHAT_GAMA_INTEGRITY;
  });

  it("overrides a mis-resolved gama when the customer names one explicitly", async () => {
    extractSlots.mockResolvedValue({ intent: "elige_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "F", // the LLM had committed F (the "SUV")
          tipo_vehiculo: "camioneta",
          cliente: {},
        },
      }),
      userMessage: "me gusta la gama c",
      recentContext: [],
      now: NOW,
    });
    void chunks;
    expect(lastSaved().slots.gama_elegida).toBe("C");
    // tipo reconciled to the chosen class so the recommendation stops pushing a camioneta.
    expect(lastSaved().slots.tipo_vehiculo).toBe("auto");
  });

  it("does NOT override on a question about a gama (not a choice)", async () => {
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "F",
          cliente: {},
        },
      }),
      userMessage: "¿cuánto vale la gama c?",
      recentContext: [],
      now: NOW,
    });
    void chunks;
    expect(lastSaved().slots.gama_elegida).toBe("F"); // unchanged — it was only a question
  });

  it("on an hour-only re-quote that moves the price, keeps the gama and explains (no re-paste)", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { hora_recogida: "06:00", hora_devolucion: "20:00" },
    });
    // Re-quote: same sede, different total + day-count (the hour crossed a billing day).
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG01",
        dias: 6,
        filas: [
          { categoria: "C", descripcion: "Económico", dias: 6, precioTotal: 1043377, horasExtra: 0, precioHoraExtra: 0, quote: "blob-c2" },
          { categoria: "F", descripcion: "SUV", dias: 6, precioTotal: 1500000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-f2" },
        ],
      },
    });
    const state: ConversationState = {
      phase: "quoted",
      slots: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        hora_recogida: "10:00",
        hora_devolucion: "10:00",
        gama_elegida: "C",
        cliente: {},
      },
      lastQuote: QUOTE_TABLE, // sede AABOG01
      flags: {
        greeted: true,
        requisitos_shown: true,
        quote_shown: true,
        last_quote_signature: "bogota||2026-07-01|2026-07-04|10:00|10:00",
        last_quote_core_signature: "bogota|2026-07-01|2026-07-04",
        summary_shown: false,
      },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state,
      userMessage: "recojo a las 6am y devuelvo a las 8pm",
      recentContext: [],
      now: NOW,
    });

    // Kept the pick, did NOT re-paste the whole table, explained the new total.
    expect(lastSaved().slots.gama_elegida).toBe("C");
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(0);
    expect(textOf(chunks)).toContain("6 días");
  });

  it("(S1) showing cards: an explicit 'gama C' in the message wins over a contaminated gama_elegida", async () => {
    // The live bug: gama_elegida got stuck on the camioneta (GC) from the bot's own recommendation;
    // every later "muéstrame los de gama C" re-showed the camioneta. The explicit code must win.
    getGamaCards.mockResolvedValue({
      gama: "C",
      descripcion: "Económico",
      modelos: [{ nombre: "Renault Kwid", imagen: "https://img/kwid.png" }],
    });
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "F", // contaminated with the camioneta (GC analog)
          tipo_vehiculo: "camioneta",
          cliente: {},
        },
      }),
      userMessage: "dime que vehiculos son los de gama C",
      recentContext: [],
      now: NOW,
    });
    expect(getGamaCards).toHaveBeenCalledWith("C", "Económico"); // C, not the stuck F
    expect(dataParts(chunks, "data-gamaCards")).toHaveLength(1);
  });

  it("(S2) a question carrying 'si' (if) is NOT a buy signal and does not commit the recommended camioneta", async () => {
    // "que vehiculo me entregan si escogo la C": isAffirmative matches the conjunction "si", so the
    // buy-signal branch fired and committed the recommended camioneta (GC) over the real question.
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { tipo_vehiculo: "camioneta", cliente: {} },
      }),
      userMessage: "que vehiculo me entregan si escogo la C",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.gama_elegida).toBeUndefined(); // did NOT commit the camioneta
    expect(textOf(chunks)).not.toContain("seguimos con la **Gama F**");
  });

  it("(S3) a BARE gama code the LLM didn't tag is resolved deterministically and advances", async () => {
    // The recurring bug: the LLM leaves gama_elegida null for a lone code, so the funnel
    // re-asks the list forever. groundGama (resolveGamaCode) resolves it against the quote.
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({ phase: "choosing_gama" }),
      userMessage: "quiero la f",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.gama_elegida).toBe("F"); // resolved without an LLM pick
    expect(textOf(chunks)).not.toContain("¿Con cuál gama seguimos?"); // no list re-ask
  });

  it("(S2-off) with the flag OFF the same question still mis-commits the camioneta (gate proof)", async () => {
    delete process.env.CHAT_GAMA_INTEGRITY;
    extractSlots.mockResolvedValue({ intent: "pregunta_gama", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { tipo_vehiculo: "camioneta", cliente: {} },
      }),
      userMessage: "que vehiculo me entregan si escogo la C",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.gama_elegida).toBe("F"); // old behavior: stuck on the camioneta
    void chunks;
  });

  it("(S3) a real affirmative (no question) still commits the recommended gama with the flag on", async () => {
    extractSlots.mockResolvedValue({ intent: "confirma_reserva", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { tipo_vehiculo: "camioneta", cliente: {} },
      }),
      userMessage: "resérvamelo",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.gama_elegida).toBe("F"); // recommended camioneta still committed
    expect(textOf(chunks)).toContain("Gama F");
  });

  it("(S4) a da_datos buy signal that names a gama explicitly commits that gama (Fix B-ii path), not the camioneta", async () => {
    // da_datos is the one buy-signal intent the R1 override (index.ts:337) does NOT cover, so this
    // exercises the explicit-gama commit inside the buy-signal branch itself, not R1.
    extractSlots.mockResolvedValue({ intent: "da_datos", updates: {} });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        phase: "choosing_gama",
        slots: { tipo_vehiculo: "camioneta", cliente: {} },
      }),
      userMessage: "ya te di mis datos, dejémoslo en la gama c",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.gama_elegida).toBe("C"); // the named C, not the recommended camioneta
    expect(lastSaved().slots.tipo_vehiculo).toBe("auto"); // tipo reconciled to the chosen class
    expect(lastSaved().phase).toBe("collecting_customer");
  });
});

// ---------------------------------------------------------------------------
// Proactive self-serve link (P3 · CHAT_SELFSERVE_LINK). On a deferral objection AFTER a
// quote, offer the web deep-link + a shareable WhatsApp quote, once. buildSelfServeLinks is
// mocked (its real output is pinned in reserva-link.test.ts); here we test the FSM wiring.
// ---------------------------------------------------------------------------

describe("orchestrator runTurn — proactive self-serve link (CHAT_SELFSERVE_LINK)", () => {
  beforeEach(() => {
    process.env.CHAT_SELFSERVE_LINK = "on";
    buildSelfServeLinks.mockReturnValue({
      webUrl: "https://alquilatucarro.com/deep-link",
      shareUrl: "https://wa.me/?text=cotizacion",
    });
  });
  afterEach(() => {
    delete process.env.CHAT_SELFSERVE_LINK;
  });

  const buttons = (chunks: Chunk[]) => dataParts(chunks, "data-buttons");

  it("offers web + share buttons once on a deferral objection after a quote", async () => {
    extractSlots.mockResolvedValue({ intent: "objecion", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "déjame pensarlo y te aviso",
      recentContext: [],
      now: NOW,
    });

    const b = buttons(chunks);
    expect(b).toHaveLength(1);
    const data = b[0].data as { web?: string; share?: string };
    expect(data.web).toBe("https://alquilatucarro.com/deep-link");
    expect(data.share).toBe("https://wa.me/?text=cotizacion");
    expect(lastSaved().flags.selfserve_link_shown).toBe(true);
  });

  it("does NOT re-offer once the link was already shown", async () => {
    extractSlots.mockResolvedValue({ intent: "objecion", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({ flags: { selfserve_link_shown: true } }),
      userMessage: "déjame pensarlo",
      recentContext: [],
      now: NOW,
    });
    expect(buttons(chunks)).toHaveLength(0);
  });

  it("does NOT offer on a price objection (no deferral signal)", async () => {
    extractSlots.mockResolvedValue({ intent: "objecion", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "está muy caro",
      recentContext: [],
      now: NOW,
    });
    expect(buttons(chunks)).toHaveLength(0);
  });

  it("does NOT offer before any quote exists", async () => {
    extractSlots.mockResolvedValue({ intent: "objecion", updates: {} });
    const noQuote: ConversationState = {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: false, quote_shown: false },
    };
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: noQuote,
      userMessage: "déjame pensarlo",
      recentContext: [],
      now: NOW,
    });
    expect(buttons(chunks)).toHaveLength(0);
  });

  it("is a no-op when the flag is off", async () => {
    delete process.env.CHAT_SELFSERVE_LINK;
    extractSlots.mockResolvedValue({ intent: "objecion", updates: {} });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState(),
      userMessage: "déjame pensarlo",
      recentContext: [],
      now: NOW,
    });
    expect(buttons(chunks)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Funnel robustness (R2 · CHAT_FUNNEL_ROBUSTNESS): answer a side question without "?" during
// data collection; reconcile tipo_vehiculo to the chosen gama.
// ---------------------------------------------------------------------------

describe("looksLikeQuestion", () => {
  it("detects questions with and without a literal '?'", () => {
    expect(looksLikeQuestion("que horario tienes")).toBe(true);
    expect(looksLikeQuestion("no tienes C")).toBe(true);
    expect(looksLikeQuestion("¿cuánto vale?")).toBe(true);
    expect(looksLikeQuestion("NO RESPONDISTE MI PREGUNTA")).toBe(true);
  });
  it("does not flag plain data answers", () => {
    expect(looksLikeQuestion("Cristo Redentor")).toBe(false);
    expect(looksLikeQuestion("CC 94494358")).toBe(false);
    expect(looksLikeQuestion("test@artesyweb.com")).toBe(false);
  });
});

describe("orchestrator runTurn — multi-booking (CHAT_MULTI_BOOKING)", () => {
  afterEach(() => {
    delete process.env.CHAT_MULTI_BOOKING;
  });

  const bookedState = (): ConversationState => ({
    phase: "booked",
    slots: {
      ciudad: "bogota",
      fecha_recogida: "2026-08-01",
      fecha_devolucion: "2026-08-06",
      gama_elegida: "C",
      cliente: { fullname: "Diego", identification: "123" },
    },
    lastQuote: QUOTE_TABLE,
    bookings: [
      { identification: "123", fecha_recogida: "2026-08-01", fecha_devolucion: "2026-08-06" },
    ],
    flags: {
      greeted: true,
      requisitos_shown: true,
      quote_shown: true,
      another_offer_shown: true,
    },
  });

  it("re-opens for another reservation on new dates (flag on)", async () => {
    process.env.CHAT_MULTI_BOOKING = "on";
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { fecha_recogida: "2026-08-20", fecha_devolucion: "2026-08-25" },
    });
    getQuoteTable.mockResolvedValue({ ok: true, table: QUOTE_TABLE });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: bookedState(),
      userMessage: "quiero otro carro del 20 al 25",
      recentContext: [],
      now: NOW,
    });
    const saved = lastSaved();
    expect(saved.phase).not.toBe("booked"); // re-opened
    expect(saved.bookings).toHaveLength(1); // ledger preserved
    expect(saved.slots.fecha_recogida).toBe("2026-08-20"); // new dates kept
    expect(saved.slots.cliente.fullname).toBeUndefined(); // responsible cleared
  });

  it("blocks the same responsible on overlapping dates and asks for another", async () => {
    process.env.CHAT_MULTI_BOOKING = "on";
    extractSlots.mockResolvedValue({
      intent: "da_datos",
      updates: { cliente: { phone: "3001234567" } },
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: {
        phase: "collecting_customer",
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-08-03", // overlaps the prior 08-01..08-06
          fecha_devolucion: "2026-08-08",
          hora_recogida: "09:00",
          hora_devolucion: "09:00",
          gama_elegida: "C",
          cliente: {
            fullname: "Diego Melo",
            identification_type: "CC",
            identification: "1020304050", // same responsible as the prior booking
            email: "d@e.com",
          },
        },
        lastQuote: QUOTE_TABLE,
        bookings: [
          { identification: "1020304050", fecha_recogida: "2026-08-01", fecha_devolucion: "2026-08-06" },
        ],
        flags: {
          greeted: true,
          requisitos_shown: true,
          quote_shown: true,
          last_quote_signature: "bogota||2026-08-03|2026-08-08|09:00|09:00",
        },
      },
      userMessage: "3001234567",
      recentContext: [],
      now: NOW,
    });
    expect(textOf(chunks).toLowerCase()).toContain("otro responsable");
    expect(lastSaved().slots.cliente.fullname).toBeUndefined(); // cleared to re-collect
    expect(lastSaved().phase).toBe("collecting_customer"); // did NOT advance to confirming
  });

  it("keeps booked terminal when the flag is off", async () => {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { fecha_recogida: "2026-08-20", fecha_devolucion: "2026-08-25" },
    });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: bookedState(),
      userMessage: "quiero otro carro del 20 al 25",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().phase).toBe("booked"); // terminal, no re-open
  });
});

describe("orchestrator runTurn — funnel robustness (CHAT_FUNNEL_ROBUSTNESS)", () => {
  afterEach(() => {
    delete process.env.CHAT_FUNNEL_ROBUSTNESS;
  });

  const collectingState = () =>
    quotedState({
      phase: "collecting_customer",
      slots: {
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-04",
        gama_elegida: "C",
        cliente: {},
      },
    });

  it("answers a side question without '?' during data collection (flag on)", async () => {
    process.env.CHAT_FUNNEL_ROBUSTNESS = "on";
    extractSlots.mockResolvedValue({ intent: "da_datos", updates: {} });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: collectingState(),
      userMessage: "que horario tienes",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalled(); // free-form answered before re-asking
  });

  it("steamrolls the same question when the flag is off (no free-form)", async () => {
    extractSlots.mockResolvedValue({ intent: "da_datos", updates: {} });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: collectingState(),
      userMessage: "que horario tienes",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).not.toHaveBeenCalled();
  });

  const outOfHoursQuote = () => ({
    intent: "cotizar" as const,
    updates: {
      ciudad: "bogota",
      fecha_recogida: "2026-08-01",
      fecha_devolucion: "2026-08-06",
      hora_recogida: "04:00",
    },
  });
  const greetedNoQuote = (): ConversationState => ({
    ...initialState(),
    flags: { greeted: true, requisitos_shown: false, quote_shown: false },
  });

  it("answers an out-of-hours quote failure with the schedule (flag on)", async () => {
    process.env.CHAT_FUNNEL_ROBUSTNESS = "on";
    extractSlots.mockResolvedValue(outOfHoursQuote());
    getQuoteTable.mockResolvedValue({
      ok: false,
      message:
        "La hora de recogida está por fuera del horario de atención de la sede seleccionada",
    });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greetedNoQuote(),
      userMessage: "recojo a las 4am",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).toHaveBeenCalled(); // free-form proposes a valid time
  });

  it("falls back to the plain error when the flag is off", async () => {
    extractSlots.mockResolvedValue(outOfHoursQuote());
    getQuoteTable.mockResolvedValue({
      ok: false,
      message:
        "La hora de recogida está por fuera del horario de atención de la sede seleccionada",
    });
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: greetedNoQuote(),
      userMessage: "recojo a las 4am",
      recentContext: [],
      now: NOW,
    });
    expect(streamText).not.toHaveBeenCalled();
    expect(textOf(chunks).toLowerCase()).toContain("horario");
  });

  it("reconciles tipo_vehiculo to the chosen gama's class", async () => {
    process.env.CHAT_FUNNEL_ROBUSTNESS = "on";
    extractSlots.mockResolvedValue({ intent: "tangencial", updates: {} });
    const { writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: quotedState({
        slots: {
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-04",
          gama_elegida: "C", // an "Económico" → auto
          tipo_vehiculo: "camioneta", // stale
          cliente: {},
        },
      }),
      userMessage: "gracias",
      recentContext: [],
      now: NOW,
    });
    expect(lastSaved().slots.tipo_vehiculo).toBe("auto");
  });
});

// Monthly suggestion (CHAT_MONTHLY_SUGGEST): for a long stay, surface the monthly rate
// when it undercuts the day-by-day total. The DB tool runTarifaMensual is mocked.
describe("orchestrator runTurn — monthly suggestion (CHAT_MONTHLY_SUGGEST)", () => {
  beforeEach(() => {
    process.env.CHAT_MONTHLY_SUGGEST = "on";
  });
  afterEach(() => {
    delete process.env.CHAT_MONTHLY_SUGGEST;
    runTarifaMensual.mockReset();
  });

  function freshState() {
    return {
      ...initialState(),
      flags: { greeted: true, requisitos_shown: true, quote_shown: false },
    } as ConversationState;
  }
  function mockQuote(dias: number, precioTotal: number) {
    extractSlots.mockResolvedValue({
      intent: "cotizar",
      updates: { ciudad: "bogota", fecha_recogida: "2026-07-01", fecha_devolucion: "2026-07-31" },
    });
    getQuoteTable.mockResolvedValue({
      ok: true,
      table: {
        sede: "AABOG01",
        dias,
        filas: [
          { categoria: "C", descripcion: "Económico", precioTotal, horasExtra: 0, precioHoraExtra: 0, quote: "blob-c" },
        ],
      },
    });
  }
  const run = async () => {
    const { chunks, writer } = fakeWriter();
    await runTurn(writer, {
      brand: "alquilatucarro",
      conversationId: "c1",
      state: freshState(),
      userMessage: "del 1 al 31 de julio",
      recentContext: [],
      now: NOW,
    });
    return chunks;
  };

  it("suggests monthly when it undercuts the day-by-day total (30 days)", async () => {
    mockQuote(30, 5_000_000);
    runTarifaMensual.mockResolvedValue({ mensual_1000km: 3_800_000 });
    const text = textOf(await run());
    expect(runTarifaMensual).toHaveBeenCalledOnce();
    expect(text).toContain("tarifa MENSUAL");
    expect(text).toContain("1.200.000"); // ahorro = 5.000.000 - 3.800.000
  });

  it("does NOT suggest (nor even query) for a short stay", async () => {
    mockQuote(3, 300_000);
    const chunks = await run();
    expect(runTarifaMensual).not.toHaveBeenCalled();
    expect(textOf(chunks)).not.toContain("tarifa MENSUAL");
  });

  it("does NOT suggest when the monthly is not cheaper than the days", async () => {
    mockQuote(30, 5_000_000);
    runTarifaMensual.mockResolvedValue({ mensual_1000km: 9_000_000 });
    expect(textOf(await run())).not.toContain("tarifa MENSUAL");
  });

  it("best-effort: a tarifa error never breaks the quote", async () => {
    mockQuote(30, 5_000_000);
    runTarifaMensual.mockRejectedValue(new Error("db down"));
    const chunks = await run();
    expect(dataParts(chunks, "data-quoteTable")).toHaveLength(1); // quote still emitted
    expect(textOf(chunks)).not.toContain("tarifa MENSUAL");
  });
});
