import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared booking core (Etapa 3). The single source of truth for the reservation
// side effect: gate → validate → caps → provider → fallback. We mock the provider,
// the caps/telemetry and the link builder to drive each BookingOutcome branch.

const events = vi.hoisted(() => ({
  countSuccessfulBookingsForConversation: vi.fn(),
  countSuccessfulBookingsForIp: vi.fn(),
  recordToolEvent: vi.fn(),
}));
vi.mock("@/lib/chat/tool-events", () => events);

const { runCrearReserva } = vi.hoisted(() => ({ runCrearReserva: vi.fn() }));
vi.mock("@/lib/chat/reserva-tool", () => ({ runCrearReserva }));

const { buildFallbackLinks } = vi.hoisted(() => ({ buildFallbackLinks: vi.fn() }));
vi.mock("@/lib/chat/reserva-link", () => ({ buildFallbackLinks }));

const { getLocationDirectory } = vi.hoisted(() => ({
  getLocationDirectory: vi.fn(),
}));
vi.mock("@/lib/api/location-directory", () => ({ getLocationDirectory }));

import { executeBooking } from "@/lib/chat/booking-core";

const CUSTOMER = {
  fullname: "Diego Melo",
  identification_type: "CC",
  identification: "1234567890",
  email: "diego@correo.com",
  phone: "3001234567",
};
const LINKS = { webUrl: "https://web/finish", whatsappUrl: "https://wa.me/57x" };
const CTX = { conversationId: "conv-1", ipHash: "iphash" };

let prevFlag: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  prevFlag = process.env.CHAT_RESERVATIONS_ENABLED;
  process.env.CHAT_RESERVATIONS_ENABLED = "true";
  events.countSuccessfulBookingsForConversation.mockResolvedValue(0);
  events.countSuccessfulBookingsForIp.mockResolvedValue(0);
  events.recordToolEvent.mockResolvedValue(undefined);
  getLocationDirectory.mockResolvedValue([]);
  buildFallbackLinks.mockReturnValue(LINKS);
  runCrearReserva.mockResolvedValue({ ok: true, data: { numero_solicitud: "AVX9" } });
});
afterEach(() => {
  if (prevFlag !== undefined) process.env.CHAT_RESERVATIONS_ENABLED = prevFlag;
  else delete process.env.CHAT_RESERVATIONS_ENABLED;
  delete process.env.CHAT_MAX_BOOKINGS_PER_CONVERSATION;
  delete process.env.CHAT_MAX_BOOKINGS_PER_IP_PER_DAY;
  delete process.env.CHAT_ATTRIBUTION_BOT;
});

function run() {
  return executeBooking({
    brand: "alquilatucarro",
    quote: "REAL_QUOTE",
    customer: CUSTOMER,
    gamaDescripcion: "económico",
    ctx: CTX,
  });
}

describe("executeBooking", () => {
  it("disabled: returns the website and never calls the provider (env off)", async () => {
    process.env.CHAT_RESERVATIONS_ENABLED = "false";
    const out = await run();
    expect(out.kind).toBe("disabled");
    if (out.kind === "disabled") {
      expect(out.website).toBe("https://alquilatucarro.com");
    }
    expect(runCrearReserva).not.toHaveBeenCalled();
  });

  it("invalid: rejects junk customer data with NO fallback links", async () => {
    const out = await executeBooking({
      brand: "alquilatucarro",
      quote: "REAL_QUOTE",
      customer: { ...CUSTOMER, email: "no-es-correo" },
      ctx: CTX,
    });
    expect(out.kind).toBe("invalid");
    if (out.kind === "invalid") expect(out.message).toMatch(/correo/i);
    expect(runCrearReserva).not.toHaveBeenCalled();
    expect(buildFallbackLinks).not.toHaveBeenCalled();
  });

  it("blocked: hands over fallback links when the per-conversation cap is hit", async () => {
    events.countSuccessfulBookingsForConversation.mockResolvedValue(3);
    const out = await run();
    expect(out.kind).toBe("blocked");
    if (out.kind === "blocked") {
      expect(out.message).toMatch(/conversación/i);
      expect(out.links).toEqual(LINKS);
    }
    expect(runCrearReserva).not.toHaveBeenCalled();
    expect(buildFallbackLinks).toHaveBeenCalledOnce();
  });

  it("ok: books and returns the provider data on success", async () => {
    const out = await run();
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") expect(out.data).toMatchObject({ numero_solicitud: "AVX9" });
    expect(runCrearReserva).toHaveBeenCalledOnce();
    expect(events.recordToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "crear_reserva", ok: true }),
    );
  });

  // Issue #199 (Fase 0): the bot stamps attribution only when CHAT_ATTRIBUTION_BOT
  // is on; off (default) keeps the override undefined so the channel derives as today.
  it("attribution: CHAT_ATTRIBUTION_BOT=true forwards attribution_channel 'chat-bot'", async () => {
    process.env.CHAT_ATTRIBUTION_BOT = "true";
    await run();
    expect(runCrearReserva).toHaveBeenCalledWith(
      expect.objectContaining({ attribution_channel: "chat-bot" }),
    );
  });

  it("attribution: flag off (default) leaves attribution_channel undefined", async () => {
    await run();
    expect(runCrearReserva).toHaveBeenCalledWith(
      expect.objectContaining({ attribution_channel: undefined }),
    );
  });

  it("failed: provider failure returns the message + fallback links", async () => {
    runCrearReserva.mockResolvedValue({ ok: false, message: "Localiza no respondió." });
    const out = await run();
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") {
      expect(out.message).toMatch(/Localiza/i);
      expect(out.links).toEqual(LINKS);
    }
    expect(buildFallbackLinks).toHaveBeenCalledOnce();
    expect(events.recordToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "crear_reserva", ok: false }),
    );
  });
});
