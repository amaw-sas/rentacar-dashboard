import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the model call and the DB layer so these stay unit-scoped.
const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject }));

const { loadConversationState, saveConversationState } = vi.hoisted(() => ({
  loadConversationState: vi.fn(),
  saveConversationState: vi.fn(),
}));
vi.mock("@/lib/chat/persistence", () => ({
  loadConversationState,
  saveConversationState,
}));

import {
  applyExtraction,
  initialState,
  type ConversationState,
} from "@/lib/chat/orchestrator/slots";
import {
  extractSlots,
  runShadowExtraction,
} from "@/lib/chat/orchestrator/extract";

beforeEach(() => {
  generateObject.mockReset();
  loadConversationState.mockReset();
  saveConversationState.mockReset();
});

describe("applyExtraction (pure merge)", () => {
  it("adds new slots without clobbering known ones", () => {
    const s = initialState();
    s.slots.ciudad = "bogota";
    const next = applyExtraction(s, {
      intent: "cotizar",
      updates: { fecha_recogida: "2026-07-01" },
    });
    expect(next.slots.ciudad).toBe("bogota");
    expect(next.slots.fecha_recogida).toBe("2026-07-01");
  });

  it("ignores empty/undefined fields so they never clobber a known value", () => {
    const s = initialState();
    s.slots.ciudad = "cali";
    const next = applyExtraction(s, {
      intent: "tangencial",
      updates: { ciudad: "" },
    });
    expect(next.slots.ciudad).toBe("cali");
  });

  it("merges the cliente sub-object", () => {
    const s = initialState();
    s.slots.cliente.fullname = "Diego Melo";
    const next = applyExtraction(s, {
      intent: "da_datos",
      updates: { cliente: { email: "a@b.com" } },
    });
    expect(next.slots.cliente.fullname).toBe("Diego Melo");
    expect(next.slots.cliente.email).toBe("a@b.com");
  });

  it("does NOT mutate phase or flags (those belong to the orchestrator)", () => {
    const s = initialState();
    const next = applyExtraction(s, {
      intent: "cotizar",
      updates: { ciudad: "bogota" },
    });
    expect(next.phase).toBe("greeting");
    expect(next.flags.greeted).toBe(false);
  });
});

describe("extractSlots", () => {
  it("returns the model's structured object", async () => {
    generateObject.mockResolvedValue({
      object: { intent: "cotizar", updates: { ciudad: "bogota" } },
    });
    const res = await extractSlots({
      todayYMD: "2026-06-25",
      state: initialState(),
      recentContext: [],
      userMessage: "quiero un carro en bogota",
    });
    expect(res.intent).toBe("cotizar");
    expect(res.updates.ciudad).toBe("bogota");
    expect(generateObject).toHaveBeenCalledOnce();
  });
});

describe("runShadowExtraction", () => {
  it("loads state, extracts, and saves the merged result", async () => {
    loadConversationState.mockResolvedValue(null); // → initialState()
    generateObject.mockResolvedValue({
      object: {
        intent: "cotizar",
        updates: { ciudad: "cali", fecha_recogida: "2026-07-02" },
      },
    });

    await runShadowExtraction({
      conversationId: "conv-1",
      todayYMD: "2026-06-25",
      recentContext: ["cliente: hola"],
      userMessage: "cali el 2 de julio",
    });

    expect(saveConversationState).toHaveBeenCalledOnce();
    const [convId, saved] = saveConversationState.mock.calls[0] as [
      string,
      ConversationState,
    ];
    expect(convId).toBe("conv-1");
    expect(saved.slots.ciudad).toBe("cali");
    expect(saved.slots.fecha_recogida).toBe("2026-07-02");
  });
});
