import type { PersistedMessage } from "./persistence";

/**
 * Input hygiene (P1 · CHAT_INPUT_DEDUP).
 *
 * Pure, server-side guard that runs BEFORE the orchestrator/legacy turn. The chat
 * fires one full turn (LLM extraction + FSM + state write) per incoming message, so a
 * message that arrives twice (a network re-send, a double submit, a WhatsApp relay)
 * produces a double greeting/quote and races the state. Dedup drops the exact
 * consecutive duplicate at the door — the only defense that covers clients we don't
 * control (the production widget lives in another repo; WhatsApp bypasses our button).
 *
 * No LLM, no network — decided from the persisted history alone → fully unit-testable.
 */

/** Default age bound: don't treat a long-unanswered message as a duplicate. */
const DEFAULT_WINDOW_MS = 120_000;

/**
 * Normalize for duplicate comparison: trim + collapse internal whitespace. NOT
 * lowercased — a re-send is byte-identical, so lowercasing would only add false
 * positives (e.g. "Sí" vs "si") without catching any real duplicate.
 */
export function normalizeForDedup(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * True when `incomingText` is an exact consecutive duplicate of the last user message.
 * Requires the LAST persisted message to be a `user` turn — if the bot already replied
 * (last message is `assistant`), the same text is a legitimate new turn (a second "sí"),
 * not a duplicate. Bounded by a short window so a stale unanswered message isn't matched.
 *
 * Best-effort: if two identical POSTs race so closely that the first's persist hasn't
 * landed when the second reads `history`, the duplicate isn't caught — consistent with
 * the fail-open posture of the existing rate limits.
 */
export function isDuplicateUserMessage(
  history: PersistedMessage[],
  incomingText: string,
  opts: { windowMs?: number; nowMs?: number } = {},
): boolean {
  const incoming = normalizeForDedup(incomingText);
  if (!incoming) return false; // never dedup an empty message

  const last = history[history.length - 1];
  if (!last || last.role !== "user") return false;

  const lastText = typeof last.content === "string" ? last.content : "";
  if (normalizeForDedup(lastText) !== incoming) return false;

  // created_at may be absent (older rows) → treat as in-window (best-effort).
  if (last.created_at) {
    const ts = Date.parse(last.created_at);
    const now = opts.nowMs ?? Date.now();
    const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    if (Number.isFinite(ts) && now - ts > windowMs) return false;
  }

  return true;
}
