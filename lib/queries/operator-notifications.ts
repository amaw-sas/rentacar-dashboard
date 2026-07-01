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

/**
 * Exact count of unread alerts — the badge number (SCEN-006). Returns `null` (not
 * 0) when the read itself fails, so the bell can distinguish a healthy empty inbox
 * from a broken one and surface a degraded state — the safety net must not hide its
 * own outage (epic #214).
 */
export async function getUnreadCount(): Promise<number | null> {
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
    return null;
  }
}

/**
 * Most recent alerts for the popover, unread first. Fetches ALL recent unread
 * (bounded by `limit`) as a dedicated query, then fills the remaining slots with
 * recent history — so an actionable unread alert is never pushed out of view by a
 * burst of newer resolved rows (the sort-after-limit hazard). Fails open to [].
 */
export async function getRecentNotifications(
  limit = RECENT_LIMIT,
): Promise<OperatorNotification[]> {
  try {
    const supabase = await createClient();

    const { data: unread, error: unreadError } = await supabase
      .from("operator_notifications")
      .select("*")
      .eq("status", "unread")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (unreadError) throw unreadError;
    const unreadRows = (unread ?? []) as OperatorNotification[];

    let historyRows: OperatorNotification[] = [];
    const remaining = limit - unreadRows.length;
    if (remaining > 0) {
      const { data: history, error: historyError } = await supabase
        .from("operator_notifications")
        .select("*")
        .neq("status", "unread")
        .order("created_at", { ascending: false })
        .limit(remaining);
      if (historyError) throw historyError;
      historyRows = (history ?? []) as OperatorNotification[];
    }

    return sortUnreadFirst([...unreadRows, ...historyRows]);
  } catch (e) {
    console.warn(
      "getRecentNotifications failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
