import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/agent";

// The system prompt carries three V1-critical pieces: a Colombia "today" anchor
// (so the LLM resolves relative dates — S5), the brand reserve link (S6), and the
// authoritative FAQ knowledge (S8). We assert their presence without invoking the
// model.

const FIXED = new Date("2026-06-20T15:00:00Z");

describe("buildSystemPrompt", () => {
  it("anchors today to the Bogota civil date", () => {
    const prompt = buildSystemPrompt("alquilatucarro", FIXED);
    expect(prompt).toContain("2026-06-20");
    expect(prompt).toContain("hora de Colombia");
  });

  it("embeds the correct reserve link per brand", () => {
    expect(buildSystemPrompt("alquilatucarro", FIXED)).toContain(
      "https://alquilatucarro.com",
    );
    expect(buildSystemPrompt("alquilame", FIXED)).toContain(
      "https://alquilame.co",
    );
    expect(buildSystemPrompt("alquicarros", FIXED)).toContain(
      "https://alquicarros.com",
    );
  });

  it("falls back to a default brand link for an unknown brand", () => {
    // getFranchiseBranding falls back to alquilame.
    expect(buildSystemPrompt("desconocida", FIXED)).toContain(
      "https://alquilame.co",
    );
  });

  it("includes the authoritative FAQ knowledge and never-invent rule", () => {
    const prompt = buildSystemPrompt("alquilame", FIXED);
    expect(prompt).toContain("CONOCIMIENTO");
    expect(prompt).toContain("Tarjeta de crédito");
    expect(prompt).toContain("NUNCA inventes precios");
  });

  it("instructs to defer monthly rentals (standard-only V1)", () => {
    const prompt = buildSystemPrompt("alquilame", FIXED);
    expect(prompt.toLowerCase()).toContain("mensualidad");
  });
});
