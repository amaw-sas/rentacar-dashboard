import { recordToolEvent } from "@/lib/chat/tool-events";
import { appendMessages } from "@/lib/chat/persistence";

/**
 * Turn-level error capture (chat observability). A chat turn can crash or time out
 * — uncaught error in the route, a model/gateway failure mid-stream, a hung tool
 * call hitting the 90s limit. Before this, those failures were INVISIBLE: only an
 * ephemeral Vercel `console.error`, nothing queryable, so the dashboard showed the
 * user's message with no reply and no error (the source of "Failed to fetch" with
 * no trace). This records every turn failure in TWO durable places:
 *
 *   1. chat_tool_events (tool='turn', ok=false) — an outage COUNT for the
 *      conversations health surface, independent of the Vercel logs.
 *   2. A `system` message in the conversation thread — the operator sees exactly
 *      which turn failed and why, inline in /conversations/[id].
 *
 * Best-effort and total: never throws, never blocks the (already failing) turn.
 * The `system` row is deliberately EXCLUDED from the model-context reload
 * (app/api/chat/route.ts) so a persisted error marker can never pollute the prompt.
 */
export async function recordTurnError(params: {
  error: unknown;
  conversationId?: string | null;
  ipHash?: string | null;
  brand?: string | null;
}): Promise<void> {
  const { error, conversationId, ipHash, brand } = params;
  const message = error instanceof Error ? error.message : String(error);
  console.error("[chat] turn failed", error);

  // Telemetry (fire-and-forget; recordToolEvent already swallows its own errors).
  void recordToolEvent({
    tool: "turn",
    ok: false,
    errorCode: message.slice(0, 300),
    brand: brand ?? null,
    conversationId: conversationId ?? null,
    ipHash: ipHash ?? null,
  });

  // Operator-visible marker in the thread. Fire-and-forget: a persist failure must
  // not throw on top of the turn failure.
  if (conversationId) {
    appendMessages(conversationId, [
      { role: "system", content: `⚠️ Error del turno: ${message}`, parts: null },
    ]).catch((e) => console.error("[chat] persist turn-error failed", e));
  }
}
