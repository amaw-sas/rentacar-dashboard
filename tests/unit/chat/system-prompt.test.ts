import { describe, it, expect, vi, beforeEach } from "vitest";

// Control what the editable knowledge base returns (null → fallback path).
const getChatKnowledgeContent = vi.fn();
vi.mock("@/lib/chat/knowledge-store", () => ({ getChatKnowledgeContent }));

import { buildSystemPrompt, chatTools } from "@/lib/chat/agent";

beforeEach(() => {
  getChatKnowledgeContent.mockReset();
});

describe("buildSystemPrompt", () => {
  it("injects the stored knowledge and the precedence rule, with the brand link", async () => {
    getChatKnowledgeContent.mockResolvedValue("CONTENIDO CURADO DE PRUEBA");
    const prompt = await buildSystemPrompt("alquilatucarro");

    expect(prompt).toContain("CONTENIDO CURADO DE PRUEBA");
    // tools-first precedence is stated explicitly
    expect(prompt).toMatch(/GANA la herramienta/);
    expect(prompt).toContain("info_sedes");
    expect(prompt).toContain("tarifa_mensual");
    // brand reserve link
    expect(prompt).toContain("https://alquilatucarro.com");
  });

  it("falls back to the requirements baseline when the store is empty", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilame");

    expect(prompt).toContain("Documentos requeridos:");
    expect(prompt).toContain("https://alquilame.co");
  });
});

describe("chatTools", () => {
  it("exposes the four tools", () => {
    expect(Object.keys(chatTools).sort()).toEqual([
      "cotizar",
      "info_gamas",
      "info_sedes",
      "tarifa_mensual",
    ]);
  });
});
