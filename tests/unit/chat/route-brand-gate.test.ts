import { describe, it, expect, vi, beforeEach } from "vitest";

// Pins the per-brand gate WIRING in the chat route: when isChatEnabledForBrand returns
// false the route refuses with a clean 403 before any DB/model work. The gate DECISION
// itself is unit-tested in brand-status.test.ts.

const h = vi.hoisted(() => ({
  isChatEnabledForBrand: vi.fn(),
  buildStreamConfig: vi.fn(),
  extractLatestQuotes: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
  createUIMessageStream: vi.fn(),
  createUIMessageStreamResponse: vi.fn(),
}));
vi.mock("@/lib/chat/agent", () => ({
  buildStreamConfig: h.buildStreamConfig,
  extractLatestQuotes: h.extractLatestQuotes,
  CHAT_MODEL_USES_GATEWAY: false,
}));
vi.mock("@/lib/chat/brand-status", () => ({
  isChatEnabledForBrand: h.isChatEnabledForBrand,
}));

import { POST } from "@/app/api/chat/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const userMsg = (text: string) => ({
  id: "u1",
  role: "user" as const,
  parts: [{ type: "text", text }],
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
});

describe("chat route — per-brand gate", () => {
  it("S2: brand disabled → 403, no DB/model work", async () => {
    h.isChatEnabledForBrand.mockResolvedValue(false);
    const res = await POST(
      req({ brand: "alquilame", messages: [userMsg("Hola")] }),
    );
    expect(res.status).toBe(403);
    expect(h.isChatEnabledForBrand).toHaveBeenCalledWith("alquilame");
    expect(h.buildStreamConfig).not.toHaveBeenCalled();
  });

  it("validates brand BEFORE the gate (missing brand → 400, gate not consulted)", async () => {
    const res = await POST(req({ messages: [userMsg("Hola")] }));
    expect(res.status).toBe(400);
    expect(h.isChatEnabledForBrand).not.toHaveBeenCalled();
  });
});
