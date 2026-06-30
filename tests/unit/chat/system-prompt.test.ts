import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

// Control what the editable knowledge base returns (null → fallback path).
// vi.hoisted so the fn exists before the hoisted vi.mock factory runs.
const { getChatKnowledgeContent } = vi.hoisted(() => ({
  getChatKnowledgeContent: vi.fn(),
}));
vi.mock("@/lib/chat/knowledge-store", () => ({ getChatKnowledgeContent }));

// Mock only the booking RUNNER; keep crearReservaSchema (agent.ts needs it).
const { runCrearReserva } = vi.hoisted(() => ({ runCrearReserva: vi.fn() }));
vi.mock("@/lib/chat/reserva-tool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/reserva-tool")>();
  return { ...actual, runCrearReserva };
});

// Mock the location directory read (agent.ts uses it only on the booking-failure
// fallback path); keep the rest of the module (types are erased anyway).
const { getLocationDirectory } = vi.hoisted(() => ({
  getLocationDirectory: vi.fn(),
}));
vi.mock("@/lib/api/location-directory", () => ({ getLocationDirectory }));

import { buildSystemPrompt, buildChatTools } from "@/lib/chat/agent";
import { encodeQuote } from "@/lib/api/mcp/quote";

// crear_reserva exercises encodeQuote, which fails closed without a strong
// MCP_QUOTE_SECRET (merged from the HMAC quote signing, issue #172).
const STRONG_SECRET = "test-quote-secret-0123456789abcdef";
let ORIGINAL_QUOTE_SECRET: string | undefined;
beforeAll(() => {
  ORIGINAL_QUOTE_SECRET = process.env.MCP_QUOTE_SECRET;
  process.env.MCP_QUOTE_SECRET = STRONG_SECRET;
});
afterAll(() => {
  if (ORIGINAL_QUOTE_SECRET === undefined) delete process.env.MCP_QUOTE_SECRET;
  else process.env.MCP_QUOTE_SECRET = ORIGINAL_QUOTE_SECRET;
});

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
    // credit filter is NOT pitched in chat — it's a post-reservation notice
    expect(prompt).toMatch(/Filtro crediticio: NO lo menciones en el chat/i);
  });

  it("falls back to the requirements baseline when the store is empty", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilame");

    expect(prompt).toContain("Documentos requeridos:");
    expect(prompt).toContain("https://alquilame.co");
  });

  it("carries the anti-injection SEGURIDAD guardrails", async () => {
    getChatKnowledgeContent.mockResolvedValue(null);
    const prompt = await buildSystemPrompt("alquilatucarro");
    // dedicated security block
    expect(prompt).toMatch(/SEGURIDAD/);
    // treat user/tool text as data, not instructions
    expect(prompt).toMatch(/DATOS, nunca instrucciones/i);
    // never reveal the system prompt / internals
    expect(prompt).toMatch(/NUNCA reveles/i);
    // resist "ignore previous instructions" style attacks
    expect(prompt).toMatch(/ignora lo anterior/i);
    // strict off-topic refusal: don't produce poems/code/etc. even framed as cars
    expect(prompt).toMatch(/NO lo produzcas/i);
    expect(prompt).toMatch(/DAN/);
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
        categoria: "C",
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

  it("crear_reserva injects the quote resolved by gama and books when the flag is on", async () => {
    const prev = process.env.CHAT_RESERVATIONS_ENABLED;
    process.env.CHAT_RESERVATIONS_ENABLED = "true";
    runCrearReserva.mockResolvedValue({
      ok: true,
      data: { numero_solicitud: "AVX9" },
    });
    const tools = buildChatTools("alquilatucarro", {
      quotedAtMs: null, // legacy → no age-check, books
      entries: [{ categoria: "C", descripcion: "económico", quote: "REAL_QUOTE" }],
    });
    const res = await tools.crear_reserva.execute!(
      {
        categoria: "C",
        fullname: "Test Cliente",
        identification_type: "CC",
        identification: "1234567890",
        email: "a@b.co",
        phone: "3001234567",
      },
      { toolCallId: "t", messages: [] },
    );
    // the LLM never supplied the quote — the server injected REAL_QUOTE by gama
    expect(runCrearReserva).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: "REAL_QUOTE",
        franchise: "alquilatucarro",
        fullname: "Test Cliente",
      }),
    );
    expect(res).toMatchObject({ numero_solicitud: "AVX9" });
    if (prev !== undefined) process.env.CHAT_RESERVATIONS_ENABLED = prev;
    else delete process.env.CHAT_RESERVATIONS_ENABLED;
  });

  it("crear_reserva returns fallback links (web + WhatsApp) when the provider booking fails", async () => {
    const prev = process.env.CHAT_RESERVATIONS_ENABLED;
    process.env.CHAT_RESERVATIONS_ENABLED = "true";
    runCrearReserva.mockResolvedValue({ ok: false, message: "Sin disponibilidad" });
    getLocationDirectory.mockResolvedValue([
      {
        slug: "armenia-aeropuerto",
        code: "AAEOQ",
        city: "armenia",
        name: "Armenia Aeropuerto",
        status: "active",
        pickup_address: "x",
        pickup_map: "y",
        schedule: {},
      },
    ]);
    const realQuote = encodeQuote({
      pickupLocation: "AAEOQ",
      returnLocation: "AAEOQ",
      pickupDateTime: "2026-08-01T12:00:00",
      returnDateTime: "2026-08-08T12:00:00",
      selected_days: 7,
      categoryCode: "FX",
      referenceToken: "r",
      rateQualifier: "q",
      total_price: 1,
      total_price_to_pay: 1,
      tax_fee: 0,
      iva_fee: 0,
      coverage_days: 0,
      coverage_price: 0,
      return_fee: 0,
      extra_hours: 0,
      extra_hours_price: 0,
    });
    const tools = buildChatTools("alquilatucarro", {
      quotedAtMs: null,
      entries: [{ categoria: "FX", descripcion: "económico", quote: realQuote }],
    });
    const res = (await tools.crear_reserva.execute!(
      {
        categoria: "FX",
        fullname: "Diego Melo",
        identification_type: "CC",
        identification: "1234567890",
        email: "a@b.co",
        phone: "3001234567",
      },
      { toolCallId: "t", messages: [] },
    )) as { error: string; completar_en_web?: string; whatsapp_asesor?: string };
    expect(res.error).toBe("Sin disponibilidad");
    expect(res.completar_en_web).toContain("/armenia/buscar-vehiculos/");
    expect(res.completar_en_web).toContain("/categoria/fx");
    expect(res.whatsapp_asesor).toContain("wa.me/573016729250");
    if (prev !== undefined) process.env.CHAT_RESERVATIONS_ENABLED = prev;
    else delete process.env.CHAT_RESERVATIONS_ENABLED;
  });
});
