"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  conversationReviewSchema,
  type ConversationReviewInput,
} from "@/lib/schemas/chat-review";

// Writes a reviewer's verdict on a chat conversation (Chat Fase 2 · Incremento
// 1). Uses the authenticated client so RLS applies and auth.uid() identifies the
// reviewer (069 adds the UPDATE policy + the four review columns). The admin
// client is intentionally NOT used here — that's only for the anonymous public
// chat route, which has no session; the reviewer does. The action writes exactly
// the four review fields, which is what keeps the open RLS policy safe.
export async function setConversationReview(
  input: ConversationReviewInput,
): Promise<{ error?: string }> {
  const parsed = conversationReviewSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos inválidos" };

  const { conversationId, label, note } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase
    .from("chat_conversations")
    .update({
      review_label: label,
      review_note: note ?? null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (error) return { error: error.message };

  revalidatePath("/conversations");
  revalidatePath(`/conversations/${conversationId}`);
  return {};
}
