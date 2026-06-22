import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads the editable chat knowledge base (Chat Fase 2 · Incremento 2). The
 * dashboard editor (/chat-knowledge) writes the `shared` scope; the public chat
 * route reads it here via the service-role admin client (the route is anonymous).
 * Returns null on any failure/empty so the caller can fall back — a DB hiccup
 * must never break the bot.
 */
export async function getChatKnowledgeContent(): Promise<string | null> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("chat_knowledge")
      .select("content")
      .eq("scope", "shared")
      .single();
    if (error || !data?.content) return null;
    const content = (data.content as string).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
