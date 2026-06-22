import { describe, it, expect, vi, beforeEach } from "vitest";

// Control what the editable knowledge base returns (null → fallback path).
// vi.hoisted so the fn exists before the hoisted vi.mock factory runs.
const { getChatKnowledgeContent } = vi.hoisted(() => ({
  getChatKnowledgeContent: vi.fn(),
}));
vi.mock("@/lib/chat/knowledge-store", () => ({ getChatKnowledgeContent }));

import { buildSystemPrompt, buildChatTools } from "@/lib/chat/agent";

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

  it("includes the reservation flow with explicit confirmation", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilatucarro");
    expect(prompt).toContain("crear_reserva");
    expect(prompt).toContain("¿Confirmo tu reserva?");
  });

  it("pins the persona as Valeria, virtual and consistently feminine", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilatucarro");
    expect(prompt).toContain("Valeria");
    // declared as a virtual assistant, not a human
    expect(prompt).toMatch(/virtual/i);
    // feminine self-reference is mandated to stop gender drift
    expect(prompt).toMatch(/femenino/i);
  });

  it("carries the verbosity guardrails (requirements once, no option menus, credit filter once)", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilatucarro");
    // requirements block sent once, not every turn
    expect(prompt).toMatch(/requisitos UNA sola vez/i);
    // no A/B/C or numbered action menus
    expect(prompt).toMatch(/NO uses menús de opciones/i);
    // credit filter mentioned a single time, neutral tone
    expect(prompt).toMatch(/Menciónalo UNA sola vez/i);
  });

  it("falls back to the requirements baseline when the store is empty", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilame");

    expect(prompt).toContain("Documentos requeridos:");
    expect(prompt).toContain("https://alquilame.co");
  });
});

describe("buildChatTools", () => {
  it("exposes the five tools", () => {
    expect(Object.keys(buildChatTools("alquilatucarro")).sort()).toEqual([
      "cotizar",
      "crear_reserva",
      "info_gamas",
      "info_sedes",
      "tarifa_mensual",
    ]);
  });

  it("crear_reserva degrades to the site link when the flag is off", async () => {
    const prev = process.env.CHAT_RESERVATIONS_ENABLED;
    delete process.env.CHAT_RESERVATIONS_ENABLED;
    const tools = buildChatTools("alquilatucarro");
    const res = (await tools.crear_reserva.execute!(
      {
        quote: "q",
        fullname: "Test",
        identification_type: "CC",
        identification: "1",
        email: "a@b.co",
        phone: "300",
      },
      { toolCallId: "t", messages: [] },
    )) as { error: string };
    expect(res.error).toContain("https://alquilatucarro.com");
    if (prev !== undefined) process.env.CHAT_RESERVATIONS_ENABLED = prev;
  });
});
