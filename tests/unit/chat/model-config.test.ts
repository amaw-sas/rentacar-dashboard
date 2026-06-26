import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chatModel,
  chatModelId,
  chatUsesGateway,
  chatProviderOptions,
} from "@/lib/chat/model-config";

// The helpers read process.env at call-time so a Vercel env change applies without a deploy.
const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.CHAT_MODEL;
  delete process.env.CHAT_MODEL_FALLBACKS;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("model-config", () => {
  it("DIRECT (no CHAT_MODEL): defaults to gpt-5, OpenAI reasoningEffort low — unchanged", () => {
    expect(chatModelId()).toBe("gpt-5");
    expect(chatUsesGateway()).toBe(false);
    expect(chatProviderOptions()).toEqual({ openai: { reasoningEffort: "low" } });
    expect(typeof chatModel()).toBe("object"); // the openai() provider, not a bare string
  });

  it("GATEWAY without fallbacks: model is the slug, NO providerOptions (today's behavior)", () => {
    process.env.CHAT_MODEL = "openai/gpt-5";
    expect(chatUsesGateway()).toBe(true);
    expect(chatModel()).toBe("openai/gpt-5"); // gateway → bare slug string
    expect(chatProviderOptions()).toBeUndefined();
  });

  it("GATEWAY with fallbacks: emits the ordered model chain (primary first), trimmed", () => {
    process.env.CHAT_MODEL = "openai/gpt-5";
    process.env.CHAT_MODEL_FALLBACKS =
      " anthropic/claude-opus-4.7 , google/gemini-2.5-flash ,";
    expect(chatProviderOptions()).toEqual({
      gateway: {
        models: [
          "openai/gpt-5",
          "anthropic/claude-opus-4.7",
          "google/gemini-2.5-flash",
        ],
      },
    });
  });

  it("fallbacks are IGNORED on the OpenAI-direct path (only meaningful via the Gateway)", () => {
    process.env.CHAT_MODEL_FALLBACKS = "anthropic/claude-opus-4.7";
    // CHAT_MODEL unset → direct → no gateway block, just reasoningEffort.
    expect(chatProviderOptions()).toEqual({ openai: { reasoningEffort: "low" } });
  });
});
