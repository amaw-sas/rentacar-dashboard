import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { resendNotification } from "@/lib/actions/notification-logs";
import { resendEmailNotification } from "@/lib/email/notifications";
import { sendEmail } from "@/lib/email/send";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/email/notifications", () => ({
  resendEmailNotification: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/wati/notifications", () => ({
  sendStatusWhatsApp: vi.fn().mockResolvedValue(undefined),
}));

// Route the two `.from(table)` reads: notification_logs (the log row) and
// reservations (the franchise lookup). resendNotification reads both via the
// RLS server client.
function setupMock(log: Record<string, unknown>, franchise: string | null = "alquilatucarro") {
  vi.mocked(createClient).mockResolvedValue({
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data:
              table === "notification_logs"
                ? log
                : franchise === null
                  ? {}
                  : { franchise },
            error: null,
          }),
        }),
      }),
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("resendNotification (issue #87)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("email channel: delegates to live re-render and succeeds when ok", async () => {
    setupMock({
      id: "log-1",
      reservation_id: "res-123",
      channel: "email",
      notification_type: "reservado_cliente",
      recipient: "old@example.com",
      subject: "Reserva Aprobada",
      html_content: "<html>frozen</html>",
    });
    vi.mocked(resendEmailNotification).mockResolvedValue({ ok: true });

    const result = await resendNotification("log-1");

    expect(result).toEqual({});
    expect(resendEmailNotification).toHaveBeenCalledWith(
      "res-123",
      "reservado_cliente",
      "alquilatucarro"
    );
    // Live path wins → no frozen-snapshot fallback send.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // SCEN-6 at the resendNotification level: unknown/legacy email type → live
  // renderer reports ok:false → fall back to the stored html snapshot.
  it("email channel: falls back to stored html when no live renderer (ok:false)", async () => {
    setupMock({
      id: "log-2",
      reservation_id: "res-123",
      channel: "email",
      notification_type: "legacy_unknown_type",
      recipient: "old@example.com",
      subject: "Asunto viejo",
      html_content: "<html>frozen-snapshot</html>",
    });
    vi.mocked(resendEmailNotification).mockResolvedValue({ ok: false });

    const result = await resendNotification("log-2");

    expect(result).toEqual({});
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        franchise: "alquilatucarro",
        to: "old@example.com",
        subject: "Asunto viejo",
        html: "<html>frozen-snapshot</html>",
        notificationType: "legacy_unknown_type_reenvio",
      })
    );
  });

  it("email channel: ok:false with no stored html returns an error", async () => {
    setupMock({
      id: "log-3",
      reservation_id: "res-123",
      channel: "email",
      notification_type: "legacy_unknown_type",
      recipient: "old@example.com",
      subject: "Asunto viejo",
      html_content: null,
    });
    vi.mocked(resendEmailNotification).mockResolvedValue({ ok: false });

    const result = await resendNotification("log-3");

    expect(result.error).toBeTruthy();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // SCEN-5: WhatsApp resend path stays unchanged — it re-fires the live status
  // sender, never the email re-render.
  it("SCEN-5: whatsapp channel still calls sendStatusWhatsApp (live), unchanged", async () => {
    setupMock({
      id: "log-4",
      reservation_id: "res-123",
      channel: "whatsapp",
      notification_type: "whatsapp_reservado",
      recipient: "+573001234567",
    });

    const result = await resendNotification("log-4");

    expect(result).toEqual({});
    expect(sendStatusWhatsApp).toHaveBeenCalledWith("res-123", "reservado");
    expect(resendEmailNotification).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
