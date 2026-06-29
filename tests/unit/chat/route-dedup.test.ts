import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Verifies the P1 dedup WIRING in the chat route: an exact consecutive duplicate of the
// last user message is dropped (no persist, no turn, empty 200) when CHAT_INPUT_DEDUP=on,
// and is a no-op when the flag is off. The dedup DECISION itself is unit-tested in
// input-hygiene.test.ts; here we pin the route behavior.

const h = vi.hoisted(() => ({
  convert: vi.fn(),
  streamText: vi.fn(),
  createUIMessageStream: vi.fn(),
  createUIMessageStreamResponse: vi.fn(),
  buildStreamConfig: vi.fn(),
  extractLatestQuotes: vi.fn(),
  loadMessages: vi.fn(),
  loadConversationState: vi.fn(),
  createConversation: vi.fn(),
  appendMessages: vi.fn(),
  countRecentMessages: vi.fn(),
  countConversationsByIp: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: h.convert,
  streamText: h.streamText,
  createUIMessageStream: h.createUIMessageStream,
  createUIMessageStreamResponse: h.createUIMessageStreamResponse,
}));
vi.mock("@/lib/chat/agent", () => ({
  buildStreamConfig: h.buildStreamConfig,
  extractLatestQuotes: h.extractLatestQuotes,
  CHAT_MODEL_USES_GATEWAY: false,
}));
vi.mock("@/lib/chat/persistence", () => ({
  loadMessages: h.loadMessages,
  loadConversationState: h.loadConversationState,
  createConversation: h.createConversation,
  appendMessages: h.appendMessages,
  countRecentMessages: h.countRecentMessages,
  countConversationsByIp: h.countConversationsByIp,
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
const persistedUser = (text: string) => ({
  role: "user" as const,
  content: text,
  parts: [{ type: "text", text }],
  created_at: new Date().toISOString(), // recent → within the dedup window
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-key";
  h.convert.mockImplementation(async (msgs: unknown) => msgs);
  h.buildStreamConfig.mockResolvedValue({});
  h.extractLatestQuotes.mockReturnValue({ quotedAtMs: null, entries: [] });
  h.appendMessages.mockResolvedValue(undefined);
  h.countRecentMessages.mockResolvedValue(0);
  h.countConversationsByIp.mockResolvedValue(0);
  h.createConversation.mockResolvedValue("conv-new");
  h.createUIMessageStream.mockReturnValue({});
  h.createUIMessageStreamResponse.mockReturnValue(
    new Response(null, { status: 200, headers: new Headers() }),
  );
  h.streamText.mockReturnValue({
    consumeStream: vi.fn(),
    toUIMessageStreamResponse: vi.fn(
      () => new Response("ok", { status: 200, headers: new Headers() }),
    ),
  });
});
afterEach(() => {
  delete process.env.CHAT_INPUT_DEDUP;
});

describe("chat route — input dedup (CHAT_INPUT_DEDUP)", () => {
  it("drops an exact consecutive duplicate: no persist, no turn, empty 200", async () => {
    process.env.CHAT_INPUT_DEDUP = "on";
    h.loadMessages.mockResolvedValue([persistedUser("Hola")]);

    const res = await POST(
      req({
        brand: "alquilatucarro",
        conversationId: "conv-1",
        messages: [userMsg("Hola")],
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-conversation-id")).toBe("conv-1");
    // No side effects: neither the user persist nor the turn ran.
    expect(h.appendMessages).not.toHaveBeenCalled();
    expect(h.buildStreamConfig).not.toHaveBeenCalled();
    // Responded via the empty UI stream.
    expect(h.createUIMessageStreamResponse).toHaveBeenCalledOnce();
  });

  it("does NOT drop when the text differs (flag on)", async () => {
    process.env.CHAT_INPUT_DEDUP = "on";
    h.loadMessages.mockResolvedValue([persistedUser("Hola")]);

    await POST(
      req({
        brand: "alquilatucarro",
        conversationId: "conv-1",
        messages: [userMsg("Bogotá")],
      }),
    );

    expect(h.appendMessages).toHaveBeenCalled(); // user persisted
    expect(h.buildStreamConfig).toHaveBeenCalled(); // turn ran (legacy path)
  });

  it("does NOT drop when the bot already replied (last message is assistant)", async () => {
    process.env.CHAT_INPUT_DEDUP = "on";
    h.loadMessages.mockResolvedValue([
      persistedUser("sí"),
      { role: "assistant", content: "¿Confirmo?", parts: [], created_at: new Date().toISOString() },
    ]);

    await POST(
      req({
        brand: "alquilatucarro",
        conversationId: "conv-1",
        messages: [userMsg("sí")],
      }),
    );

    expect(h.buildStreamConfig).toHaveBeenCalled();
  });

  it("is a no-op when the flag is off (duplicate proceeds normally)", async () => {
    h.loadMessages.mockResolvedValue([persistedUser("Hola")]);

    await POST(
      req({
        brand: "alquilatucarro",
        conversationId: "conv-1",
        messages: [userMsg("Hola")],
      }),
    );

    expect(h.appendMessages).toHaveBeenCalled();
    expect(h.buildStreamConfig).toHaveBeenCalled();
  });
});
