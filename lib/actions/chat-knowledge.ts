"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { chatKnowledgeSchema } from "@/lib/schemas/chat-knowledge";

// Updates the shared chat knowledge document (Chat Fase 2 · Incremento 2). Uses
// the authenticated client so RLS applies; the dashboard is staff-only. Writing
// here changes the bot's fallback knowledge at the next request (no deploy).
export async function updateChatKnowledge(
  content: string,
): Promise<{ error?: string }> {
  const parsed = chatKnowledgeSchema.safeParse({ content });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Contenido inválido" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase
    .from("chat_knowledge")
    .update({
      content: parsed.data.content,
      updated_at: new Date().toISOString(),
    })
    .eq("scope", "shared");

  if (error) return { error: error.message };

  revalidatePath("/chat-knowledge");
  return {};
}
