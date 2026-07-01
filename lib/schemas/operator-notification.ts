import { z } from "zod";

// Operator notification center (#215). Hand-written types + Zod input guards for
// the operator alert inbox. `operator_notifications` is not in the (vestigial)
// generated lib/types/database.ts, so the row shape lives here and queries cast
// at the client boundary — consistent with the rest of the dashboard.

export type OperatorNotificationStatus = "unread" | "read" | "resolved";
export type OperatorNotificationSeverity = "error" | "warning" | "info";

/** One row of `operator_notifications` as read by the dashboard. */
export interface OperatorNotification {
  id: string;
  type: string;
  severity: OperatorNotificationSeverity;
  source: string;
  source_id: string | null;
  title: string;
  body: string | null;
  resource_type: string | null;
  resource_id: string | null;
  action: string | null;
  action_ref: string | null;
  status: OperatorNotificationStatus;
  created_at: string;
  read_at: string | null;
  resolved_at: string | null;
}

/**
 * Mutation input guard. Every action (markRead/resolve/resend) receives a single
 * notification id from the client; validate it is a uuid before touching the DB so
 * a malformed id surfaces a Spanish message instead of a Postgres error.
 */
export const notificationIdSchema = z
  .string()
  .uuid({ message: "Identificador de notificación inválido" });
