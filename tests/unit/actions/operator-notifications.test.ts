import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resendNotification } from "@/lib/actions/notification-logs";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/notification-logs", () => ({
  resendNotification: vi.fn(),
}));

const UUID = "550e8400-e29b-41d4-a716-446655440000";

/**
 * One chainable stand-in for the PostgREST builder. `update`/`select`/`eq` return
 * the chain; awaiting the chain yields the update result; `single()` yields the
 * selected row. `captured` records what update() and single() were asked for.
 */
function mockClient(opts: {
  selectRow?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}) {
  const captured: {
    table: string | null;
    update: Record<string, unknown> | null;
    eqs: Array<[string, unknown]>;
  } = { table: null, update: null, eqs: [] };

  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (v: Record<string, unknown>) => {
      captured.update = v;
      return chain;
    },
    eq: (c: string, v: unknown) => {
      captured.eqs.push([c, v]);
      return chain;
    },
    single: () =>
      Promise.resolve({
        data: opts.selectRow ?? null,
        error: opts.selectRow ? null : { message: "not found" },
      }),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ error: opts.updateError ?? null }),
  };

  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      captured.table = table;
      return chain;
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  return captured;
}

describe("operator-notification actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("markRead: rejects a non-uuid id with a Spanish error, no DB touch", async () => {
    mockClient({});
    const { markRead } = await import("@/lib/actions/operator-notifications");
    const res = await markRead("bad");
    expect(res).toEqual({ error: "Identificador de notificación inválido" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("resolveNotification: sets status=resolved and revalidates the layout", async () => {
    const cap = mockClient({ updateError: null });
    const { resolveNotification } = await import(
      "@/lib/actions/operator-notifications"
    );
    const res = await resolveNotification(UUID);
    expect(res).toEqual({});
    expect(cap.update).toMatchObject({ status: "resolved" });
    expect(cap.update?.resolved_at).toBeTruthy();
    expect(cap.eqs).toContainEqual(["id", UUID]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("markAllRead: moves unread rows to read and revalidates", async () => {
    const cap = mockClient({ updateError: null });
    const { markAllRead } = await import(
      "@/lib/actions/operator-notifications"
    );
    const res = await markAllRead();
    expect(res).toEqual({});
    expect(cap.update).toMatchObject({ status: "read" });
    expect(cap.eqs).toContainEqual(["status", "unread"]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("resendOperatorNotification: on resend success, resolves the alert", async () => {
    mockClient({
      selectRow: { action: "resend", action_ref: "log-1" },
      updateError: null,
    });
    vi.mocked(resendNotification).mockResolvedValue({});
    const { resendOperatorNotification } = await import(
      "@/lib/actions/operator-notifications"
    );
    const res = await resendOperatorNotification(UUID);
    expect(resendNotification).toHaveBeenCalledWith("log-1");
    expect(res).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("resendOperatorNotification: on resend failure, surfaces the error and does NOT resolve", async () => {
    mockClient({
      selectRow: { action: "resend", action_ref: "log-1" },
    });
    vi.mocked(resendNotification).mockResolvedValue({
      error: "No se pudo reenviar",
    });
    const { resendOperatorNotification } = await import(
      "@/lib/actions/operator-notifications"
    );
    const res = await resendOperatorNotification(UUID);
    expect(res).toEqual({ error: "No se pudo reenviar" });
    // No resolve → no layout revalidate on the failure path.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("resendOperatorNotification: rejects an alert that does not support resend", async () => {
    mockClient({ selectRow: { action: null, action_ref: null } });
    const { resendOperatorNotification } = await import(
      "@/lib/actions/operator-notifications"
    );
    const res = await resendOperatorNotification(UUID);
    expect(res.error).toBeTruthy();
    expect(resendNotification).not.toHaveBeenCalled();
  });
});
