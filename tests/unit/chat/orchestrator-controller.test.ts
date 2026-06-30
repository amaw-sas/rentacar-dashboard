import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the model call so these stay unit-scoped. The Controller's VALUE-ADD that we can test
// deterministically is the commit gate + context building; real reference resolution is the
// model's job and is measured by the live self-play eval (tests mock the model).
const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject }));

import { runController } from "@/lib/chat/orchestrator/controller";
import {
  initialState,
  type ConversationState,
} from "@/lib/chat/orchestrator/slots";

const QUOTE_TABLE = {
  sede: "AABOG01",
  dias: 3,
  filas: [
    { categoria: "C", descripcion: "Gama C Económico Mecánico", dias: 3, precioTotal: 300000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-c" },
    { categoria: "F", descripcion: "Gama F SUV Automática", dias: 3, precioTotal: 500000, horasExtra: 0, precioHoraExtra: 0, quote: "blob-f" },
  ],
};

function quotedState(over: Partial<ConversationState> = {}): ConversationState {
  return {
    phase: "choosing_gama",
    slots: { ciudad: "bogota", fecha_recogida: "2026-07-01", fecha_devolucion: "2026-07-04", cliente: {} },
    lastQuote: QUOTE_TABLE,
    flags: { greeted: true, requisitos_shown: true, quote_shown: true },
    ...over,
  };
}

const baseInput = (over: Partial<ConversationState>, userMessage: string) => ({
  todayYMD: "2026-06-27",
  state: quotedState(over),
  recentContext: [],
  userMessage,
});

/** Make generateObject return a Controller object (defaults fill the unused slot fields). */
function mockController(obj: {
  intent?: string;
  action: string;
  gama_code?: string | null;
  updates?: Record<string, unknown>;
}) {
  generateObject.mockResolvedValue({
    object: {
      intent: obj.intent ?? "elige_gama",
      action: obj.action,
      gama_code: obj.gama_code ?? null,
      updates: {
        ciudad: null, sede: null, fecha_recogida: null, fecha_devolucion: null,
        hora_recogida: null, hora_devolucion: null, gama_elegida: null,
        transmision: null, tipo_vehiculo: null, cantidad: null, cliente: null,
        ...obj.updates,
      },
    },
  });
}

beforeEach(() => generateObject.mockReset());
afterEach(() => delete process.env.CHAT_GAMA_INTEGRITY);

describe("Controller — commit gate (the wrong-gama fix)", () => {
  it("COMMIT_GAMA with a valid resolved code SETS gama_elegida", async () => {
    mockController({ action: "COMMIT_GAMA", gama_code: "F", intent: "elige_gama" });
    const res = await runController(baseInput({}, "esa SUV me sirve, la tomo"));
    expect(res.updates.gama_elegida).toBe("F");
    expect(res.action).toBe("COMMIT_GAMA");
  });

  it("normalizes the committed code to the quote row's casing", async () => {
    mockController({ action: "COMMIT_GAMA", gama_code: "f" });
    const res = await runController(baseInput({}, "la f"));
    expect(res.updates.gama_elegida).toBe("F"); // findGama returns the canonical row code
  });

  it("ANSWER about a gama does NOT commit it (no premature funnel jump)", async () => {
    // "¿el Sandero (F) cuánto vale?" — resolves the reference for answering, but it is a QUESTION.
    mockController({ action: "ANSWER", gama_code: "F", intent: "pregunta_gama" });
    const res = await runController(baseInput({}, "¿el segundo cuánto vale?"));
    expect(res.updates.gama_elegida).toBeNull();
  });

  it("COMMIT_GAMA with a PHANTOM code (not in the quote) commits nothing", async () => {
    mockController({ action: "COMMIT_GAMA", gama_code: "Z" });
    const res = await runController(baseInput({}, "la Z"));
    expect(res.updates.gama_elegida).toBeNull();
  });

  it("COMMIT_GAMA with no quote yet commits nothing", async () => {
    mockController({ action: "COMMIT_GAMA", gama_code: "C" });
    const res = await runController({
      todayYMD: "2026-06-27",
      state: initialState(),
      recentContext: [],
      userMessage: "la económica",
    });
    expect(res.updates.gama_elegida).toBeNull();
  });

  it("never lets the model set gama_elegida via updates on a non-commit", async () => {
    // Even if the model wrongly stuffs gama_elegida into updates, the gate overrides it to null.
    mockController({ action: "ANSWER", gama_code: null, updates: { gama_elegida: "C" } });
    const res = await runController(baseInput({}, "¿tienen seguro?"));
    expect(res.updates.gama_elegida).toBeNull();
  });
});

describe("Controller — slot passthrough + context", () => {
  it("passes intent and slot updates through like the extractor", async () => {
    mockController({
      action: "QUOTE",
      intent: "cotizar",
      updates: { ciudad: "medellin", transmision: "automatico", tipo_vehiculo: "camioneta" },
    });
    const res = await runController(baseInput({}, "una camioneta automática en Medellín"));
    expect(res.intent).toBe("cotizar");
    expect(res.updates.ciudad).toBe("medellin");
    expect(res.updates.transmision).toBe("automatico");
    expect(res.updates.tipo_vehiculo).toBe("camioneta");
  });

  it("injects the recently-discussed gamas as the deixis anchor (incl. free-form mentions)", async () => {
    mockController({ action: "COMMIT_GAMA", gama_code: "F" });
    // Valeria surfaced C then F in free-form text (never committed); 'esa me sirve' should anchor to F.
    await runController({
      todayYMD: "2026-06-27",
      state: quotedState(),
      recentContext: [
        "assistant: La Gama C (económico mecánico) te queda en $300.000.",
        "user: y tiene maletero grande?",
        "assistant: te recomiendo la Gama F, SUV automática.",
      ],
      userMessage: "esa me sirve",
    });
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Gamas discutidas recientemente");
    expect(prompt).toContain("C, F"); // order oldest→newest
    expect(prompt).toContain("La más reciente es F");
  });

  it("with CHAT_GAMA_INTEGRITY on, the anchor ignores the bot's own gama mentions", async () => {
    process.env.CHAT_GAMA_INTEGRITY = "on";
    mockController({ action: "ANSWER", gama_code: null });
    await runController({
      todayYMD: "2026-06-27",
      state: quotedState(),
      recentContext: [
        "assistant: te recomiendo la Gama F, SUV automática.",
        "user: me interesa la gama c",
      ],
      userMessage: "esa me sirve",
    });
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    // Anchored to the CLIENT's mention (C), NOT the bot's recommended F.
    expect(prompt).toContain("La más reciente es C");
    expect(prompt).not.toContain("La más reciente es F");
  });

  it("feeds the model a context with numbered rows, prices and model names", async () => {
    mockController({ action: "ANSWER", gama_code: null });
    await runController(
      baseInput(
        { modelsByGama: { C: ["Kia Picanto", "Chevrolet Spark"], F: ["Renault Sandero"] } },
        "cuál me recomiendas",
      ),
    );
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("1. Gama C"); // numbered rows (position references)
    expect(prompt).toContain("2. Gama F");
    expect(prompt).toContain("Kia Picanto"); // model names (model-name references)
    expect(prompt).toContain("Renault Sandero");
    expect(prompt).toContain("Fase del embudo: choosing_gama"); // phase awareness
  });
});
