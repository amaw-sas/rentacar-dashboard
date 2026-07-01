import { createClient } from "@/lib/supabase/server";
import type { OperatorNotification } from "@/lib/schemas/operator-notification";

// Reads for the operator notification center (#215). Both functions run in the
// dashboard LAYOUT, so they fail OPEN (0 / []) rather than throwing: a stats hiccup
// or a not-yet-applied migration must never take down every dashboard route. This
// mirrors getChatToolHealth / getConversationMetrics and honors SCEN-5 (fails open
// to all-OK). It is a deliberate deviation from the "queries throw" convention,
// justified by the layout-level blast radius.

const RECENT_LIMIT = 20;

/**
 * Unread-first, then newest-first. Pure and stable so the popover ordering is
 * unit-testable and never depends on a raw PostgREST expression order (which
 * PostgREST cannot express without a view/RPC). ISO timestamps sort
 * lexicographically, so a string compare is a correct chronological compare.
 */
export function sortUnreadFirst(
  rows: OperatorNotification[],
): OperatorNotification[] {
  return [...rows].sort((a, b) => {
    const aUnread = a.status === "unread" ? 0 : 1;
    const bUnread = b.status === "unread" ? 0 : 1;
    if (aUnread !== bUnread) return aUnread - bUnread;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Exact count of unread alerts — the badge number (SCEN-006). */
export async function getUnreadCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("operator_notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "unread");
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.warn(
      "getUnreadCount failed:",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

/** Most recent alerts for the popover, unread first. */
export async function getRecentNotifications(
  limit = RECENT_LIMIT,
): Promise<OperatorNotification[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("operator_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return sortUnreadFirst((data ?? []) as OperatorNotification[]);
  } catch (e) {
    console.warn(
      "getRecentNotifications failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
