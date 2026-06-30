import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether the public chat should serve for a given brand (per-brand on/off switch).
 *
 * Gated behind CHAT_BRAND_SWITCH so the switch is inert until launch day: with the flag
 * off the chat serves for every brand (byte-identical legacy behavior — preview/testing
 * unaffected). With the flag on, the per-brand state in chat_brand_settings decides,
 * read via the service-role admin client (the chat route is anonymous). Any failure, a
 * missing row, or a missing table degrades to OFF (safe default: a paused bot beats one
 * serving a brand that was meant to be off). Never throws.
 *
 * Shared by the chat route (enforcement) and /api/chat/status (the widget's show/hide
 * signal) so both read one source of truth.
 */
export async function isChatEnabledForBrand(brand: string): Promise<boolean> {
  if (process.env.CHAT_BRAND_SWITCH !== "on") return true;
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("chat_brand_settings")
      .select("enabled")
      .eq("brand", brand)
      .single();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}
