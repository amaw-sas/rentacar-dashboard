import { describe, it, expect, vi, afterEach } from "vitest";

// Force the requirements fallback (store empty) so buildSystemPrompt is
// deterministic without a DB — same approach as agent.test.ts.
vi.mock("@/lib/chat/knowledge-store", () => ({
  getChatKnowledgeContent: vi.fn(async () => null),
}));

// CHAT_MODEL / CHAT_MODEL_USES_GATEWAY are read at module load, so each case
// sets the env, resets the module registry, and re-imports.
const ORIGINAL = process.env.CHAT_MODEL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CHAT_MODEL;
  else process.env.CHAT_MODEL = ORIGINAL;
  vi.resetModules();
});

describe("CHAT_MODEL selection", () => {
  it("defaults to GPT-5 via the OpenAI provider with reasoningEffort low", async () => {
    delete process.env.CHAT_MODEL;
    vi.resetModules();
    const { CHAT_MODEL, CHAT_MODEL_USES_GATEWAY, buildStreamConfig } =
      await import("@/lib/chat/agent");

    expect(CHAT_MODEL).toBe("gpt-5");
    expect(CHAT_MODEL_USES_GATEWAY).toBe(false);

    const cfg = await buildStreamConfig("alquilatucarro", []);
    // openai() returns a model object, not a bare string.
    expect(typeof cfg.model).not.toBe("string");
    expect(cfg.providerOptions).toEqual({ openai: { reasoningEffort: "low" } });
  });

  it("routes a Gateway slug as a plain string with no OpenAI providerOptions", async () => {
    process.env.CHAT_MODEL = "anthropic/claude-haiku-4.5";
    vi.resetModules();
    const { CHAT_MODEL, CHAT_MODEL_USES_GATEWAY, buildStreamConfig } =
      await import("@/lib/chat/agent");

    expect(CHAT_MODEL).toBe("anthropic/claude-haiku-4.5");
    expect(CHAT_MODEL_USES_GATEWAY).toBe(true);

    const cfg = await buildStreamConfig("alquilatucarro", []);
    // String model → Gateway routing; effort is OpenAI-only, so it's omitted.
    expect(cfg.model).toBe("anthropic/claude-haiku-4.5");
    expect(cfg.providerOptions).toBeUndefined();
  });
});
