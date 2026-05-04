import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { logNotification } from "@/lib/actions/notification-logs";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
}));

const mockSend = vi.fn();

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
      constructor(_apiKey: string) {
        // no-op
      }
    },
  };
});

import { sendEmail } from "@/lib/email/send";

function setupFranchise(
  senderEmail: string,
  senderName = "Test Sender",
  replyToEmail: string | null = null
) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              sender_email: senderEmail,
              sender_name: senderName,
              reply_to_email: replyToEmail,
            },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createAdminClient>);
}

describe("sendEmail (Resend) — golden path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALQUILATUCARRO_RESEND_API_KEY = "re_test_alquilatucarro";
    process.env.ALQUILAME_RESEND_API_KEY = "re_test_alquilame";
    process.env.ALQUICARROS_RESEND_API_KEY = "re_test_alquicarros";
  });

  afterEach(() => {
    delete process.env.ALQUILATUCARRO_RESEND_API_KEY;
    delete process.env.ALQUILAME_RESEND_API_KEY;
    delete process.env.ALQUICARROS_RESEND_API_KEY;
  });

  // SCEN-001: Resend reemplaza completamente a nodemailer
  it("calls resend.emails.send exactly once on success", async () => {
    setupFranchise("info@mail.alquilatucarro.com", "Alquila tu Carro");
    mockSend.mockResolvedValue({ data: { id: "resend-abc-123" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // SCEN-004: From subdominio, Reply-To apex
  it("sets From with sender_name and sender_email subdomain, Reply-To apex", async () => {
    setupFranchise("info@mail.alquilatucarro.com", "Alquila tu Carro");
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Alquila tu Carro" <info@mail.alquilatucarro.com>',
        to: ["customer@example.com"],
        replyTo: "info@alquilatucarro.com",
        subject: "Test",
        html: "<p>hi</p>",
      })
    );
  });

  // SCEN-override: franchises.reply_to_email overrides deriveReplyTo when set
  it("uses franchises.reply_to_email as Reply-To when set (override path)", async () => {
    setupFranchise(
      "info@mail.alquicarros.com",
      "Alquicarros",
      "alquicarroscolombia@gmail.com"
    );
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquicarros",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Alquicarros" <info@mail.alquicarros.com>',
        replyTo: "alquicarroscolombia@gmail.com",
      })
    );
  });

  // SCEN-override: List-Unsubscribe also points to override address (operational consistency)
  it("uses reply_to_email override in the List-Unsubscribe header too", async () => {
    setupFranchise(
      "info@mail.alquicarros.com",
      "Alquicarros",
      "alquicarroscolombia@gmail.com"
    );
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquicarros",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const args = mockSend.mock.calls[0][0];
    expect(args.headers["List-Unsubscribe"]).toBe(
      "<mailto:alquicarroscolombia@gmail.com?subject=Unsubscribe>"
    );
  });

  // SCEN-fallback: when reply_to_email is null, deriveReplyTo is used (preserves alquilatucarro behavior)
  it("falls back to deriveReplyTo when reply_to_email is null (fallback path)", async () => {
    setupFranchise("info@mail.alquilatucarro.com", "Alquila tu Carro", null);
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: "info@alquilatucarro.com",
      })
    );
  });

  it("includes List-Unsubscribe header pointing to the apex address", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const args = mockSend.mock.calls[0][0];
    expect(args.headers).toMatchObject({
      "List-Unsubscribe": "<mailto:info@alquilatucarro.com?subject=Unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("passes text and bcc when provided (wrapped as arrays where Resend expects)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
      bcc: "internal@alquilatucarro.com",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hi",
        bcc: ["internal@alquilatucarro.com"],
      })
    );
  });

  it("omits text and bcc when not provided", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    const args = mockSend.mock.calls[0][0];
    expect(args).not.toHaveProperty("text");
    expect(args).not.toHaveProperty("bcc");
  });

  it("logs notification with status=sent on success (SCEN-001)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({
      data: { id: "resend-message-id" },
      error: null,
    });

    await sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      reservationId: "r1",
      notificationType: "reservado_cliente",
    });

    expect(vi.mocked(logNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation_id: "r1",
        channel: "email",
        notification_type: "reservado_cliente",
        recipient: "customer@example.com",
        subject: "Test",
        status: "sent",
      })
    );
  });
});

describe("sendEmail — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALQUILATUCARRO_RESEND_API_KEY = "re_test_key";
  });

  afterEach(() => {
    delete process.env.ALQUILATUCARRO_RESEND_API_KEY;
  });

  // SCEN-005: rate_limit retry succeeds
  it("retries on rate_limit_exceeded and succeeds on second attempt (SCEN-005)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend
      .mockResolvedValueOnce({
        data: null,
        error: { name: "rate_limit_exceeded", message: "Too many requests" },
      })
      .mockResolvedValueOnce({
        data: { id: "abc-123" },
        error: null,
      });

    vi.useFakeTimers();
    const promise = sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      reservationId: "r1",
      notificationType: "reservado_cliente",
    });

    await vi.advanceTimersByTimeAsync(9000);
    await promise;
    vi.useRealTimers();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
      })
    );
  });

  // SCEN-006: validation_error → no retry, throw, log failed
  it("throws and logs failed without retry on validation_error (SCEN-006)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `from` field" },
    });

    await expect(
      sendEmail({
        franchise: "alquilatucarro",
        to: "customer@example.com",
        subject: "Test",
        html: "<p>hi</p>",
        reservationId: "r2",
        notificationType: "reservado_cliente",
      })
    ).rejects.toThrow();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.stringContaining("Invalid `from` field"),
      })
    );
  });

  // SCEN-013: defensive { data: null, error: null }
  it("treats { data: null, error: null } as failure (SCEN-013)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({ data: null, error: null });

    await expect(
      sendEmail({
        franchise: "alquilatucarro",
        to: "customer@example.com",
        subject: "Test",
        html: "<p>hi</p>",
        reservationId: "r3",
        notificationType: "reservado_cliente",
      })
    ).rejects.toThrow();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.any(String),
      })
    );
  });

  // SCEN-014: timeout/network exception triggers retry
  it("retries on send exception and fails after MAX_RETRIES (SCEN-014)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockImplementation(async () => {
      throw new Error("network timeout");
    });

    vi.useFakeTimers();
    const promise = sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      reservationId: "r4",
      notificationType: "reservado_cliente",
    });
    // Attach a catch handler immediately to prevent unhandled-rejection noise.
    promise.catch(() => {});

    // Advance through 2 retry delays of 8s each = 16s
    await vi.advanceTimersByTimeAsync(20000);
    await expect(promise).rejects.toThrow();
    vi.useRealTimers();

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logNotification)).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
      })
    );
  });

  // 5xx → retry
  it("retries on application_error with 5xx statusCode", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "application_error",
          message: "Internal server error",
          statusCode: 503,
        },
      })
      .mockResolvedValueOnce({
        data: { id: "abc-after-5xx" },
        error: null,
      });

    vi.useFakeTimers();
    const promise = sendEmail({
      franchise: "alquilatucarro",
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
    });

    await vi.advanceTimersByTimeAsync(9000);
    await promise;
    vi.useRealTimers();

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // application_error 4xx (e.g., invalid api key) → no retry
  it("does NOT retry on application_error with non-5xx statusCode (e.g., 401)", async () => {
    setupFranchise("info@mail.alquilatucarro.com");
    mockSend.mockResolvedValue({
      data: null,
      error: {
        name: "application_error",
        message: "Invalid API key",
        statusCode: 401,
      },
    });

    await expect(
      sendEmail({
        franchise: "alquilatucarro",
        to: "customer@example.com",
        subject: "Test",
        html: "<p>hi</p>",
      })
    ).rejects.toThrow();

    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
