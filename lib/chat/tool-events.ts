import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  withSupabaseRetry,
  withTimeout,
  CHAT_DB_READ_TIMEOUT_MS,
} from "@/lib/chat/db-resilience";

/**
 * Tool-event telemetry for the chat (Inc. 4 "Escudo"). Every `cotizar` /
 * `crear_reserva` execution writes one row to chat_tool_events. Two consumers:
 *
 * - Observability: the dashboard computes a per-tool failure rate and raises a
 *   visible health alert when it spikes.
 * - Anti-abuse: the booking rate caps count prior SUCCESSFUL `crear_reserva` per
 *   conversation and per IP.
 *
 * Writes go through the service-role admin client (the public route has no
 * session). recordToolEvent is FIRE-AND-FORGET and swallows every error — telemetry
 * must never break or slow a customer's turn. The count helpers FAIL OPEN (return 0
 * on error) so a DB hiccup never blocks a legitimate booking.
 */

// 'turn' is NOT a tool — it's the per-request turn-failure marker (chat crashed/
// timed out). Recorded ok=false only, so it surfaces as an outage COUNT, never a
// fail-rate (there are no ok=true 'turn' rows). See lib/chat/turn-error.ts.
export type ChatToolName = "cotizar" | "crear_reserva" | "turn";

export interface ToolEvent {
  tool: ChatToolName;
  ok: boolean;
  errorCode?: string | null;
  brand?: string | null;
  conversationId?: string | null;
  ipHash?: string | null;
  latencyMs?: number | null;
}

/** Best-effort insert. Never throws, never blocks the response. */
export async function recordToolEvent(event: ToolEvent): Promise<void> {
  try {
    const client = createAdminClient();
    // Retry transient socket failures so a dropped keep-alive doesn't silently
    // drop telemetry (incl. the turn-error count that powers the health banner).
    const { error } = await withSupabaseRetry(() =>
      client.from("chat_tool_events").insert({
        tool: event.tool,
        ok: event.ok,
        error_code: event.errorCode ?? null,
        brand: event.brand ?? null,
        conversation_id: event.conversationId ?? null,
        ip_hash: event.ipHash ?? null,
        latency_ms: event.latencyMs ?? null,
      }),
    );
    if (error) console.error("[chat] recordToolEvent insert failed", error);
  } catch (e) {
    console.error("[chat] recordToolEvent failed", e);
  }
}

/** Count successful bookings in a conversation (per-conversation cap). Fails open. */
export async function countSuccessfulBookingsForConversation(
  conversationId: string,
  client: SupabaseClient = createAdminClient(),
): Promise<number> {
  try {
    const { count, error } = await withTimeout(
      () =>
        client
          .from("chat_tool_events")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId)
          .eq("tool", "crear_reserva")
          .eq("ok", true),
      CHAT_DB_READ_TIMEOUT_MS,
      "countSuccessfulBookingsForConversation",
    );
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.error("[chat] countSuccessfulBookingsForConversation failed", e);
    return 0;
  }
}

/** Count successful bookings from an IP since `sinceISO` (per-IP cap). Fails open. */
export async function countSuccessfulBookingsForIp(
  ipHash: string,
  sinceISO: string,
  client: SupabaseClient = createAdminClient(),
): Promise<number> {
  try {
    const { count, error } = await withTimeout(
      () =>
        client
          .from("chat_tool_events")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .eq("tool", "crear_reserva")
          .eq("ok", true)
          .gte("created_at", sinceISO),
      CHAT_DB_READ_TIMEOUT_MS,
      "countSuccessfulBookingsForIp",
    );
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.error("[chat] countSuccessfulBookingsForIp failed", e);
    return 0;
  }
}
