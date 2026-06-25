import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ConversationState } from "@/lib/chat/orchestrator/slots";

/**
 * Chatbot persistence (V1). Writes anonymous web-chat conversations to Supabase
 * via the service-role admin client (bypasses RLS; the public chat route has no
 * session). Reads are reserved for authenticated dashboard users via RLS.
 *
 * Tables: `chat_conversations`, `chat_messages` (migration 064).
 */

export interface PersistedMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  parts?: unknown;
  // ISO timestamp of the row. Loaded so the route can age-check the last quote
  // (re-cotizar instead of booking a stale price). Optional: not all callers set it.
  created_at?: string | null;
}

/**
 * Create a conversation row and return its id. `ipHash` is the salted SHA-256 of
 * the client IP (never the raw IP) — stored so the per-IP rate limit can count
 * new conversations per address. Null when no salt/IP is available.
 */
export async function createConversation(
  brand: string,
  cityDetected?: string | null,
  ipHash?: string | null,
  client: SupabaseClient = createAdminClient(),
): Promise<string> {
  const { data, error } = await client
    .from("chat_conversations")
    .insert({ brand, city_detected: cityDetected ?? null, ip_hash: ipHash ?? null })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Count conversations opened from one IP at/after `sinceISO`. Drives the per-IP
 * new-conversation cap — the layer that closes the "open a fresh conversation to
 * dodge the per-conversation message cap" bypass.
 */
export async function countConversationsByIp(
  ipHash: string,
  sinceISO: string,
  client: SupabaseClient = createAdminClient(),
): Promise<number> {
  const { count, error } = await client
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceISO);

  if (error) throw error;
  return count ?? 0;
}

/** Append one or more messages to a conversation. No-op on an empty array. */
export async function appendMessages(
  conversationId: string,
  messages: PersistedMessage[],
  client: SupabaseClient = createAdminClient(),
): Promise<void> {
  if (messages.length === 0) return;

  const rows = messages.map((m) => ({
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
    parts: m.parts ?? null,
  }));

  const { error } = await client.from("chat_messages").insert(rows);
  if (error) throw error;
}

/**
 * Load the full message history of a conversation, oldest first. Returns each
 * row's `parts` VERBATIM (the AI SDK UIMessage parts stored as jsonb): the chat
 * route feeds these straight back into `convertToModelMessages` so tool context
 * — the opaque `cotizar` quote among it — survives across turns. The widget only
 * resends plain text, so the server is the source of truth for prior turns. Same
 * deterministic ordering (`created_at` then `id`) as the dashboard review query.
 */
export async function loadMessages(
  conversationId: string,
  client: SupabaseClient = createAdminClient(),
): Promise<PersistedMessage[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select("role, content, parts, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PersistedMessage[];
}

/**
 * Load the hybrid orchestrator's conversation state (Rediseño híbrido · Etapa 1).
 * Returns null when unset (legacy conversations / orchestrator off) so the caller
 * falls back to `initialState()`. Reads the `state` jsonb column (migration 073).
 */
export async function loadConversationState(
  conversationId: string,
  client: SupabaseClient = createAdminClient(),
): Promise<ConversationState | null> {
  const { data, error } = await client
    .from("chat_conversations")
    .select("state")
    .eq("id", conversationId)
    .single();

  if (error || !data?.state) return null;
  return data.state as ConversationState;
}

/**
 * Persist the orchestrator state. Mirrors `phase` to its own column for dashboard
 * filtering. Best-effort by contract: the caller wraps it (shadow mode must never
 * break the reply if the columns/migration aren't present yet).
 */
export async function saveConversationState(
  conversationId: string,
  state: ConversationState,
  client: SupabaseClient = createAdminClient(),
): Promise<void> {
  const { error } = await client
    .from("chat_conversations")
    .update({ state, phase: state.phase })
    .eq("id", conversationId);

  if (error) throw error;
}

/**
 * Count messages in a conversation created at/after `sinceISO`. Drives the V1
 * per-conversation rate cap (the soft anti-abuse layer alongside the Vercel WAF).
 */
export async function countRecentMessages(
  conversationId: string,
  sinceISO: string,
  client: SupabaseClient = createAdminClient(),
): Promise<number> {
  const { count, error } = await client
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .gte("created_at", sinceISO);

  if (error) throw error;
  return count ?? 0;
}
