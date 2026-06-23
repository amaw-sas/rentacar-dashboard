import { describe, it, expect, vi, beforeEach } from "vitest";

// The public chat route rebuilds the model context from the SERVER-PERSISTED
// conversation history (not the text-only widget payload) so tool context — the
// opaque `cotizar` quote — survives across turns. These tests pin the context
// assembly: what `convertToModelMessages` receives on each branch.
//
// vi.hoisted so the spies exist before the hoisted vi.mock factories run.
const h = vi.hoisted(() => ({
  convert: vi.fn(),
  streamText: vi.fn(),
  buildStreamConfig: vi.fn(),
  extractLatestQuotes: vi.fn(),
  loadMessages: vi.fn(),
  createConversation: vi.fn(),
  appendMessages: vi.fn(),
  countRecentMessages: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: h.convert,
  streamText: h.streamText,
}));
vi.mock("@/lib/chat/agent", () => ({
  buildStreamConfig: h.buildStreamConfig,
  extractLatestQuotes: h.extractLatestQuotes,
}));
vi.mock("@/lib/chat/persistence", () => ({
  loadMessages: h.loadMessages,
  createConversation: h.createConversation,
  appendMessages: h.appendMessages,
  countRecentMessages: h.countRecentMessages,
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
  h.convert.mockImplementation(async (msgs: unknown) => msgs); // identity
  h.buildStreamConfig.mockResolvedValue({});
  h.extractLatestQuotes.mockReturnValue({ quotedAtMs: null, entries: [] });
  h.appendMessages.mockResolvedValue(undefined);
  h.countRecentMessages.mockResolvedValue(0);
  h.createConversation.mockResolvedValue("conv-new");
  h.streamText.mockReturnValue({
    consumeStream: vi.fn(),
    toUIMessageStreamResponse: vi.fn(
      () => new Response("ok", { status: 200, headers: new Headers() }),
    ),
  });
});

describe("chat route — model context assembly", () => {
  it("on a confirm turn, feeds persisted history (with the cotizar quote) + the new user message", async () => {
    const history = [
      { role: "user", content: "cotiza", parts: [{ type: "text", text: "cotiza" }] },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-cotizar",
            toolCallId: "call_1",
            state: "output-available",
            input: { ciudad: "cartagena" },
            output: { disponibilidad: { quote: "OPAQUE_QUOTE" } },
          },
        ],
      },
    ];
    h.loadMessages.mockResolvedValue(history);
    const latest = { quotedAtMs: 123, entries: [{ categoria: "C", quote: "OPAQUE_QUOTE" }] };
    h.extractLatestQuotes.mockReturnValue(latest);

    await POST(req({ brand: "alquilatucarro", conversationId: "conv-1", messages: [userMsg("Si")] }));

    expect(h.loadMessages).toHaveBeenCalledWith("conv-1");
    // server resolves the quote from history and hands it to the stream config
    expect(h.extractLatestQuotes).toHaveBeenCalledWith(history);
    expect(h.buildStreamConfig).toHaveBeenCalledWith(
      "alquilatucarro",
      expect.anything(),
      latest,
    );
    const [ctx, opts] = h.convert.mock.calls[0];
    // history (2) + current user message (1)
    expect(ctx).toHaveLength(3);
    // the quote round-trips into context
    const toolMsg = ctx.find((m: { parts?: Array<{ type?: string }> }) =>
      m.parts?.some((p) => p.type === "tool-cotizar"),
    );
    expect(JSON.stringify(toolMsg)).toContain("OPAQUE_QUOTE");
    // current turn is appended last, exactly once
    expect(ctx[ctx.length - 1].parts[0].text).toBe("Si");
    expect(ctx.filter((m: { parts?: Array<{ text?: string }> }) => m.parts?.[0]?.text === "Si")).toHaveLength(1);
    // defensive convert option
    expect(opts).toEqual({ ignoreIncompleteToolCalls: true });
  });

  it("falls back to the request messages for a new conversation (no id, never loads)", async () => {
    const messages = [userMsg("hola")];

    await POST(req({ brand: "alquilatucarro", messages }));

    expect(h.createConversation).toHaveBeenCalledWith("alquilatucarro");
    expect(h.loadMessages).not.toHaveBeenCalled();
    expect(h.convert.mock.calls[0][0]).toEqual(messages);
  });

  it("degrades to the request messages when loadMessages fails", async () => {
    h.loadMessages.mockRejectedValue(new Error("db down"));
    const messages = [userMsg("Si")];

    await POST(req({ brand: "alquilatucarro", conversationId: "conv-1", messages }));

    expect(h.loadMessages).toHaveBeenCalledWith("conv-1");
    expect(h.convert.mock.calls[0][0]).toEqual(messages);
  });

  it("degrades to the request messages when history is empty", async () => {
    h.loadMessages.mockResolvedValue([]);
    const messages = [userMsg("Si")];

    await POST(req({ brand: "alquilatucarro", conversationId: "conv-1", messages }));

    expect(h.convert.mock.calls[0][0]).toEqual(messages);
  });
});
