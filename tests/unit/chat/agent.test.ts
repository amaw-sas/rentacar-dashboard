import { describe, it, expect, vi } from "vitest";

// Force the requirements fallback (store empty) so the prompt is deterministic
// without a DB. Knowledge injection from the store is covered in
// system-prompt.test.ts.
vi.mock("@/lib/chat/knowledge-store", () => ({
  getChatKnowledgeContent: vi.fn(async () => null),
}));

import { buildSystemPrompt } from "@/lib/chat/agent";

// The system prompt carries the Colombia "today" anchor (so the LLM resolves
// relative dates), the brand reserve link, and the fallback knowledge. We assert
// their presence without invoking the model.

const FIXED = new Date("2026-06-20T15:00:00Z");

describe("buildSystemPrompt", () => {
  it("anchors today to the Bogota civil date", async () => {
    const prompt = await buildSystemPrompt("alquilatucarro", FIXED);
    expect(prompt).toContain("2026-06-20");
    expect(prompt).toContain("hora de Colombia");
  });

  it("embeds the correct reserve link per brand", async () => {
    expect(await buildSystemPrompt("alquilatucarro", FIXED)).toContain(
      "https://alquilatucarro.com",
    );
    expect(await buildSystemPrompt("alquilame", FIXED)).toContain(
      "https://alquilame.co",
    );
    expect(await buildSystemPrompt("alquicarros", FIXED)).toContain(
      "https://alquicarros.com",
    );
  });

  it("falls back to a default brand link for an unknown brand", async () => {
    // getFranchiseBranding falls back to alquilame.
    expect(await buildSystemPrompt("desconocida", FIXED)).toContain(
      "https://alquilame.co",
    );
  });

  it("includes the fallback knowledge and never-invent rule", async () => {
    const prompt = await buildSystemPrompt("alquilame", FIXED);
    expect(prompt).toContain("CONOCIMIENTO");
    expect(prompt).toContain("Tarjeta de crédito");
    expect(prompt).toContain("NUNCA inventes precios");
  });

  it("handles monthly rentals via the tarifa_mensual tool", async () => {
    const prompt = await buildSystemPrompt("alquilame", FIXED);
    expect(prompt).toContain("tarifa_mensual");
    expect(prompt.toLowerCase()).toContain("por mes");
  });
});
