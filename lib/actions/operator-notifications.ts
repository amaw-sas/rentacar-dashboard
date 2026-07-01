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
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("operator_notifications")
    .update({ status: "resolved", resolved_at: now, read_at: now })
    .eq("id", parsed.data);
  if (error) return { error: "No se pudo marcar como resuelta" };

  refreshBell();
  return {};
}

/**
 * Resend the client notification behind a 'resend' alert, reusing the existing
 * resendNotification (live email re-render / WhatsApp resend). On success the
 * alert is resolved; on failure its Spanish error is surfaced and the alert stays
 * unread so the operator can retry.
 */
export async function resendOperatorNotification(
  id: string,
): Promise<{ error?: string }> {
  const parsed = notificationIdSchema.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operator_notifications")
    .select("action, action_ref")
    .eq("id", parsed.data)
    .single();
  if (error || !data) return { error: "Notificación no encontrada" };

  const notif = data as { action: string | null; action_ref: string | null };
  if (notif.action !== "resend" || !notif.action_ref) {
    return { error: "Esta notificación no admite reenvío" };
  }

  const res = await resendNotification(notif.action_ref);
  if (res.error) return { error: res.error };

  return resolveNotification(parsed.data);
}
