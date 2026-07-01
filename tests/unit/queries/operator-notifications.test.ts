import { describe, it, expect } from "vitest";
import { sortUnreadFirst } from "@/lib/queries/operator-notifications";
import type { OperatorNotification } from "@/lib/schemas/operator-notification";

function row(
  id: string,
  status: OperatorNotification["status"],
  created_at: string,
): OperatorNotification {
  return {
    id,
    type: "notification_failed",
    severity: "error",
    source: "notification_logs",
    source_id: id,
    title: `alert ${id}`,
    body: null,
    resource_type: "reservation",
    resource_id: null,
    action: "resend",
    action_ref: id,
    status,
    created_at,
    read_at: null,
    resolved_at: null,
  };
}

describe("sortUnreadFirst", () => {
  it("puts unread rows before read/resolved ones (SCEN-007 history stays below)", () => {
    const input = [
      row("resolved-new", "resolved", "2026-07-01T10:00:00Z"),
      row("unread-old", "unread", "2026-06-30T09:00:00Z"),
      row("read-mid", "read", "2026-07-01T08:00:00Z"),
      row("unread-new", "unread", "2026-07-01T09:00:00Z"),
    ];
    const out = sortUnreadFirst(input).map((r) => r.id);
    // Both unread first (newest unread before older unread), then the rest newest-first.
    expect(out).toEqual([
      "unread-new",
      "unread-old",
      "resolved-new",
      "read-mid",
    ]);
  });

  it("orders newest-first within the unread group", () => {
    const input = [
      row("u1", "unread", "2026-07-01T01:00:00Z"),
      row("u3", "unread", "2026-07-01T03:00:00Z"),
      row("u2", "unread", "2026-07-01T02:00:00Z"),
    ];
    expect(sortUnreadFirst(input).map((r) => r.id)).toEqual(["u3", "u2", "u1"]);
  });

  it("does not mutate the input array", () => {
    const input = [row("a", "read", "2026-07-01T01:00:00Z"), row("b", "unread", "2026-07-01T02:00:00Z")];
    const copy = [...input];
    sortUnreadFirst(input);
    expect(input).toEqual(copy);
  });
});
