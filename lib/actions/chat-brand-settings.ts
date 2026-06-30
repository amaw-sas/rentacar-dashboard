"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { FRANCHISES } from "@/lib/schemas/reservation";

// Toggles the chat on/off for one brand (Operaciones › Base de conocimiento). Uses the
// authenticated client so RLS applies (the dashboard is staff-only). The change takes
// effect at the next chat request with no deploy — the bot reads the same table via the
// admin client (lib/chat/brand-status.ts). Enforcement is still gated by CHAT_BRAND_SWITCH.
export async function setChatBrandEnabled(
  brand: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  if (!FRANCHISES.includes(brand as (typeof FRANCHISES)[number])) {
    return { error: "Marca inválida" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase.from("chat_brand_settings").upsert(
    { brand, enabled, updated_at: new Date().toISOString() },
    { onConflict: "brand" },
  );

  if (error) return { error: error.message };

  revalidatePath("/chat-knowledge");
  return {};
}
