import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";
import { checkPendingReservationStatuses } from "@/lib/reminders/check-pending-status";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/wati/notifications", () => ({ sendStatusWhatsApp: vi.fn() }));
vi.mock("@/lib/email/notifications", () => ({
  sendReservationNotifications: vi.fn().mockResolvedValue(undefined),
}));

// Lets the awaited fetch/json/update microtasks settle so the function reaches its
// final `await Promise.allSettled(dispatches)` before we assert it is still pending.
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("checkPendingReservationStatuses — dispatch completion", () => {
  const proxyUrl = process.env.LOCALIZA_PROXY_URL;
  const proxyKey = process.env.PROXY_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOCALIZA_PROXY_URL = "https://proxy.test";
    process.env.PROXY_API_KEY = "test-key";

    const pending = [
      { id: "res-1", reservation_code: "ABC123", franchise: "alquilatucarro" },
    ];
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: pending, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createAdminClient>);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reservationStatus: "Confirmed",
          reserveCode: "ABC123",
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.LOCALIZA_PROXY_URL = proxyUrl;
    process.env.PROXY_API_KEY = proxyKey;
  });

  // SCEN-004: the cron must not resolve until the spaced WhatsApp dispatch settles,
  // otherwise Vercel can reclaim the instance mid-sequence and drop messages.
  it("does not resolve until the in-flight WhatsApp dispatch settles", async () => {
    let resolveDispatch!: () => void;
    const dispatch = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    vi.mocked(sendStatusWhatsApp).mockReturnValue(dispatch);

    let settled = false;
    const cron = checkPendingReservationStatuses().then((result) => {
      settled = true;
      return result;
    });

    await flush();
    expect(sendStatusWhatsApp).toHaveBeenCalledWith("res-1", "reservado");
    expect(settled).toBe(false); // still awaiting the spaced dispatch

    resolveDispatch();
    const result = await cron;

    expect(settled).toBe(true);
    expect(result).toEqual({ checked: 1, updated: 1, errors: 0 });
  });
});
