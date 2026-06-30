import { openai } from "@ai-sdk/openai";

/**
 * Chat model selection + Vercel AI Gateway model-fallback config, shared by the slot
 * extractor, the free-form reply, and the legacy agent so all three behave identically.
 *
 * Env:
 * - `CHAT_MODEL`: a bare id ("gpt-5") → OpenAI provider DIRECT; a provider slug
 *   ("openai/gpt-5") → the Vercel AI Gateway. Default "gpt-5" so an unset env is a no-op.
 * - `CHAT_MODEL_FALLBACKS` (Gateway only): comma-separated provider slugs tried IN ORDER
 *   when the primary model fails or is unavailable, e.g.
 *   "anthropic/claude-opus-4.7,google/gemini-2.5-flash". Empty/unset → no fallback (today's
 *   behavior). The chat keeps answering on the next provider while one is down/rate-limited.
 *
 * Read at call-time (not module load) so a Vercel env change applies without a code deploy.
 */
export function chatModelId(): string {
  return process.env.CHAT_MODEL ?? "gpt-5";
}

/** True when CHAT_MODEL is a Gateway slug (`provider/model`), not a bare OpenAI id. */
export function chatUsesGateway(): boolean {
  return chatModelId().includes("/");
}

/** Ordered fallback slugs from CHAT_MODEL_FALLBACKS (Gateway only); [] when unset. */
function chatFallbacks(): string[] {
  return (process.env.CHAT_MODEL_FALLBACKS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Model arg for streamText/generateObject: a Gateway slug string, or the OpenAI provider. */
export function chatModel() {
  const id = chatModelId();
  return chatUsesGateway() ? id : openai(id);
}

/**
 * providerOptions for a chat call.
 * - OpenAI DIRECT path: `reasoningEffort: 'low'` — the GPT-5 sweet spot (intelligence ~64 at
 *   low vs ~67 at medium but ~3x faster); OpenAI-specific (Haiku rejects `effort`), so it
 *   stays off the Gateway path.
 * - Gateway path: the ordered model-fallback chain (primary first) when CHAT_MODEL_FALLBACKS
 *   is set; otherwise undefined (unchanged from today).
 *
 * NOTE (verify live): the Gateway `models` array here is the FULL chain (primary + fallbacks).
 * If a Gateway version treats `models` as fallbacks-ONLY, drop the primary — a one-line tweak.
 */
// JSON-object shape (no optional-undefined props) so it satisfies the AI SDK's
// `providerOptions` index signature (Record<string, JSONObject>).
type ProviderOptions = Record<string, Record<string, string | string[]>>;

export function chatProviderOptions(): ProviderOptions | undefined {
  if (chatUsesGateway()) {
    const fallbacks = chatFallbacks();
    if (!fallbacks.length) return undefined;
    return { gateway: { models: [chatModelId(), ...fallbacks] } };
  }
  return { openai: { reasoningEffort: "low" } };
}

/**
 * Hard wall-clock cap for a single model call. Without it a hung provider keeps the
 * `await` pending until Vercel kills the function at `maxDuration` (90s) — too late for
 * the route's catch to run, so the turn dies with NO reply and NO trace. ~30s sits well
 * under that ceiling: a normal turn is ~5s, so this never bites a healthy call, but a
 * hang aborts in time to degrade and still answer. Overridable via CHAT_LLM_TIMEOUT_MS.
 */
export function chatLlmTimeoutMs(): number {
  const raw = Number(process.env.CHAT_LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/** AbortSignal that fires after {@link chatLlmTimeoutMs}, for every model call. */
export function chatAbortSignal(): AbortSignal {
  return AbortSignal.timeout(chatLlmTimeoutMs());
}
