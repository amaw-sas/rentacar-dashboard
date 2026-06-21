import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

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
}

/** Create a conversation row and return its id. */
export async function createConversation(
  brand: string,
  cityDetected?: string | null,
  client: SupabaseClient = createAdminClient(),
): Promise<string> {
  const { data, error } = await client
    .from("chat_conversations")
    .insert({ brand, city_detected: cityDetected ?? null })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
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
