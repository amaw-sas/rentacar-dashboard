import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTransporter } from "@/lib/email/client";
import { sendEmail } from "@/lib/email/send";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/email/client", () => ({
  createTransporter: vi.fn(),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
}));

const sendMailMock = vi.fn();

function setupFranchise(senderEmail: string, senderName = "Test Sender") {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { sender_email: senderEmail, sender_name: senderName },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createAdminClient>);

  vi.mocked(createTransporter).mockReturnValue({
    sendMail: sendMailMock,
  } as unknown as ReturnType<typeof createTransporter>);
}

describe("sendEmail deliverability headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: "<abc@test>" });
  });

  it("sets replyTo equal to the franchise sender_email", async () => {
    setupFranchise("reservas@alquilatucarro.com");

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "reservas@alquilatucarro.com" })
    );
  });

  it("includes List-Unsubscribe mailto header pointing to sender_email", async () => {
    setupFranchise("reservas@alquilame.com");

    await sendEmail({
      franchise: "alquilame",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const args = sendMailMock.mock.calls[0][0];
    expect(args.headers).toMatchObject({
      "List-Unsubscribe": "<mailto:reservas@alquilame.com?subject=Unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("includes text part when provided", async () => {
    setupFranchise("reservas@alquicarros.com");

    await sendEmail({
      franchise: "alquicarros",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "hi", html: "<p>hi</p>" })
    );
  });

  it("omits text property when not provided", async () => {
    setupFranchise("reservas@alquilatucarro.com");

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const args = sendMailMock.mock.calls[0][0];
    expect(args).not.toHaveProperty("text");
  });

  it("warns when sender_email differs from SMTP MAIL_USER", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ALQUILATUCARRO_MAIL_USER = "smtp-bot@gmail.com";

    setupFranchise("reservas@alquilatucarro.com");

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("DMARC alignment risk")
    );
    warnSpy.mockRestore();
  });

  it("does not warn when sender_email matches SMTP MAIL_USER (case-insensitive)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ALQUILAME_MAIL_USER = "Reservas@AlQuilame.com";

    setupFranchise("reservas@alquilame.com");

    await sendEmail({
      franchise: "alquilame",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const mismatchWarnings = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("DMARC alignment risk")
    );
    expect(mismatchWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });
});
