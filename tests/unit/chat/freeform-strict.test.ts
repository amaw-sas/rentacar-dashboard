import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// P2 — stricter FSM/free-form border (CHAT_FREEFORM_STRICT). Pins the pure sede-context
// formatter and the freeFormConfig wiring (info_sedes description softened + lower step cap
// in strict mode, unchanged when off). The KB + model deps are mocked so the config builds
// without network; buildChatTools runs for real so we test the ACTUAL info_sedes description.

vi.mock("@/lib/chat/faq", () => ({ buildKnowledgeSection: async () => "" }));
vi.mock("@/lib/chat/model-config", () => ({
  chatModel: () => ({}),
  chatProviderOptions: () => ({}),
}));

import {
  freeFormConfig,
  freeFormSedeContext,
} from "@/lib/chat/orchestrator/prompts";

const steps = (n: number) => ({ steps: Array.from({ length: n }) });

afterEach(() => {
  delete process.env.CHAT_FREEFORM_STRICT;
});

describe("freeFormSedeContext — known-city injection (pure)", () => {
  it("builds a context line from resolved sedes (with and without horario)", () => {
    const line = freeFormSedeContext("bogota", {
      sedes: [
        { nombre: "Bogotá Aeropuerto", horario: "L-V 8-6" },
        { nombre: "Bogotá Norte" },
      ],
    });
    expect(line).toContain("Sedes de bogota");
    expect(line).toContain("NO uses info_sedes para esta ciudad");
    expect(line).toContain("Bogotá Aeropuerto (L-V 8-6)");
    expect(line).toContain("Bogotá Norte");
  });

  it("returns empty string when there is nothing usable to inject", () => {
    expect(freeFormSedeContext("tulua", { error: "No tengo sede en..." })).toBe("");
    expect(freeFormSedeContext("bogota", { sedes: [] })).toBe("");
    expect(freeFormSedeContext("bogota", null)).toBe("");
    expect(freeFormSedeContext("bogota", "weird")).toBe("");
  });
});

describe("freeFormConfig — strict border (CHAT_FREEFORM_STRICT)", () => {
  beforeEach(() => {
    delete process.env.CHAT_FREEFORM_STRICT;
  });

  it("off (default): keeps the original info_sedes description and a 4-step cap", async () => {
    const cfg = await freeFormConfig("alquilatucarro");
    const desc = (cfg.tools.info_sedes as { description: string }).description;
    expect(desc).toContain("SIEMPRE");
    const stop = cfg.stopWhen as (a: { steps: unknown[] }) => boolean;
    expect(stop(steps(2))).toBe(false); // not yet at 4
    expect(stop(steps(4))).toBe(true);
  });

  it("on: softens info_sedes to 'only for a different city' and caps at 2 steps", async () => {
    process.env.CHAT_FREEFORM_STRICT = "on";
    const cfg = await freeFormConfig("alquilatucarro");
    const desc = (cfg.tools.info_sedes as { description: string }).description;
    expect(desc).not.toContain("SIEMPRE");
    expect(desc).toContain("OTRA ciudad");
    const stop = cfg.stopWhen as (a: { steps: unknown[] }) => boolean;
    expect(stop(steps(2))).toBe(true); // capped earlier than the default 4
  });

  it("never exposes the booking/quote tools in either mode", async () => {
    const cfg = await freeFormConfig("alquilatucarro");
    expect(cfg.tools).not.toHaveProperty("crear_reserva");
    expect(cfg.tools).not.toHaveProperty("cotizar");
    expect(cfg.tools).toHaveProperty("info_sedes");
  });
});
