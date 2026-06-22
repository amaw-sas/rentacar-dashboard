import { createClient } from "@/lib/supabase/server";

// Authenticated read of an editable knowledge document for the dashboard editor
// (RLS lets authenticated users SELECT). The bot's own read path is separate
// (lib/chat/knowledge-store.ts, admin client) — the chat route is anonymous.
export async function getChatKnowledge(scope: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_knowledge")
    .select("scope, content, updated_at")
    .eq("scope", scope)
    .single();
  if (error) throw error;
  return data;
}
