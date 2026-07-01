"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notificationIdSchema } from "@/lib/schemas/operator-notification";
import { resendNotification } from "@/lib/actions/notification-logs";

// Mutations for the operator notification center (#215). Convention: return
// { error?: string } (Spanish), never throw to the client. The count/list are
// fetched in the dashboard LAYOUT, so every mutation revalidates the layout scope
// — a page-scoped revalidate would not refresh the bell.

/** The count/list live in app/(dashboard)/layout.tsx → must revalidate the layout. */
function refreshBell(): void {
  revalidatePath("/", "layout");
}

/** Mark one alert as read (drops it from the unread badge, keeps it as history). */
export async function markRead(id: string): Promise<{ error?: string }> {
  const parsed = notificationIdSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("operator_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("status", "unread"); // never downgrade a resolved alert back to read
  if (error) return { error: "No se pudo marcar como leída" };

  refreshBell();
  return {};
}

/** Bulk: clear the unread badge without resolving anything. */
export async function markAllRead(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("operator_notifications")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("status", "unread");
  if (error) return { error: "No se pudieron marcar como leídas" };

  refreshBell();
  return {};
}

/** Mark one alert as resolved (attended). Valid from any status. */
export async function resolveNotification(
  id: string,
): Promise<{ error?: string }> {
  const parsed = notificationIdSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  // Only set resolved_at; never clobber an earlier read_at with resolve-time.
  const { error } = await supabase
    .from("operator_notifications")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", parsed.data);
  if (error) return { error: "No se pudo marcar como resuelta" };

  refreshBell();
  return {};
}

/** Undo an optimistic claim when the downstream resend never went through. */
async function revertClaim(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<void> {
  await supabase
    .from("operator_notifications")
    .update({ status: "unread", resolved_at: null })
    .eq("id", id);
}

/**
 * Resend the client notification behind a 'resend' alert, reusing the existing
 * resendNotification (live email re-render / WhatsApp resend).
 *
 * Claim-first: atomically flip unread→resolved BEFORE sending, so only the caller
 * that wins the claim actually sends. Concurrent clicks, two open tabs, or a retry
 * after the alert was already handled see zero claimed rows and no-op — the live
 * customer notification never fires twice from this widget. If the send fails the
 * claim is reverted so the operator can retry.
 */
export async function resendOperatorNotification(
  id: string,
): Promise<{ error?: string }> {
  const parsed = notificationIdSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: claimed, error: claimError } = await supabase
    .from("operator_notifications")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("status", "unread")
    .select("action, action_ref")
    .maybeSingle();

  if (claimError) return { error: "No se pudo reenviar" };
  if (!claimed) {
    // Already handled (or not unread) → nothing to resend, no duplicate send.
    refreshBell();
    return {};
  }

  const notif = claimed as { action: string | null; action_ref: string | null };
  if (notif.action !== "resend" || !notif.action_ref) {
    await revertClaim(supabase, parsed.data);
    return { error: "Esta notificación no admite reenvío" };
  }

  const res = await resendNotification(notif.action_ref);
  if (res.error) {
    await revertClaim(supabase, parsed.data);
    return { error: res.error };
  }

  refreshBell();
  return {};
}
