import { createClient } from "@/lib/supabase/server";
import { FRANCHISES } from "@/lib/schemas/reservation";

export type ChatBrandSettings = Record<string, boolean>;

/**
 * Per-brand chat on/off state for the dashboard toggles (authenticated read; RLS lets
 * staff SELECT). Always returns an entry for every brand in FRANCHISES — a brand with no
 * row yet is reported OFF, mirroring the bot's read path (lib/chat/brand-status.ts). A
 * query error degrades to all-OFF rather than throwing, so the editor page never breaks.
 */
export async function getChatBrandSettings(): Promise<ChatBrandSettings> {
  const result: ChatBrandSettings = {};
  for (const b of FRANCHISES) result[b] = false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_brand_settings")
    .select("brand, enabled");
  if (error || !data) return result;

  for (const row of data) {
    if (typeof row.brand === "string" && row.brand in result) {
      result[row.brand] = row.enabled === true;
    }
  }
  return result;
}
