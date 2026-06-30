import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Booking rate caps (Inc. 4). crear_reserva must refuse to book once the per-
// conversation or per-IP cap is hit, BEFORE calling the provider. We mock the
// count helpers (the DB layer) and the booking runner to drive each branch.

const counts = vi.hoisted(() => ({
  countSuccessfulBookingsForConversation: vi.fn(),
  countSuccessfulBookingsForIp: vi.fn(),
  recordToolEvent: vi.fn(),
}));
vi.mock("@/lib/chat/tool-events", () => counts);

const { runCrearReserva } = vi.hoisted(() => ({ runCrearReserva: vi.fn() }));
vi.mock("@/lib/chat/reserva-tool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/reserva-tool")>();
  return { ...actual, runCrearReserva };
});

import { buildChatTools } from "@/lib/chat/agent";

const LATEST = {
  quotedAtMs: null,
  entries: [{ categoria: "C", descripcion: "económico", quote: "REAL_QUOTE" }],
};
const ARGS = {
  categoria: "C",
  fullname: "Diego Melo",
  identification_type: "CC",
  identification: "1234567890",
  email: "diego@correo.com",
  phone: "3001234567",
};
const CTX = { conversationId: "conv-1", ipHash: "iphash" };

let prevFlag: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  prevFlag = process.env.CHAT_RESERVATIONS_ENABLED;
  process.env.CHAT_RESERVATIONS_ENABLED = "true";
  counts.countSuccessfulBookingsForConversation.mockResolvedValue(0);
  counts.countSuccessfulBookingsForIp.mockResolvedValue(0);
  counts.recordToolEvent.mockResolvedValue(undefined);
  runCrearReserva.mockResolvedValue({ ok: true, data: { numero_solicitud: "AVX9" } });
});
afterEach(() => {
  if (prevFlag !== undefined) process.env.CHAT_RESERVATIONS_ENABLED = prevFlag;
  else delete process.env.CHAT_RESERVATIONS_ENABLED;
  delete process.env.CHAT_MAX_BOOKINGS_PER_CONVERSATION;
  delete process.env.CHAT_MAX_BOOKINGS_PER_IP_PER_DAY;
});

async function book() {
  const tools = buildChatTools("alquilatucarro", LATEST, CTX);
  return tools.crear_reserva.execute!(ARGS, { toolCallId: "t", messages: [] });
}

describe("crear_reserva booking caps", () => {
  it("books when under both caps", async () => {
    const res = await book();
    expect(runCrearReserva).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ numero_solicitud: "AVX9" });
  });

  it("blocks (no provider call) when the per-conversation cap is reached", async () => {
    counts.countSuccessfulBookingsForConversation.mockResolvedValue(3);
    const res = (await book()) as { error: string };
    expect(runCrearReserva).not.toHaveBeenCalled();
    expect(res.error).toMatch(/conversación/i);
  });

  it("blocks (no provider call) when the per-IP daily cap is reached", async () => {
    counts.countSuccessfulBookingsForIp.mockResolvedValue(5);
    const res = (await book()) as { error: string };
    expect(runCrearReserva).not.toHaveBeenCalled();
    expect(res.error).toMatch(/máximo de reservas/i);
  });

  it("honors the per-conversation env override", async () => {
    process.env.CHAT_MAX_BOOKINGS_PER_CONVERSATION = "1";
    counts.countSuccessfulBookingsForConversation.mockResolvedValue(1);
    const res = (await book()) as { error: string };
    expect(runCrearReserva).not.toHaveBeenCalled();
    expect(res.error).toMatch(/conversación/i);
  });

  it("skips cap checks when no context is threaded (unit/test callers)", async () => {
    counts.countSuccessfulBookingsForConversation.mockResolvedValue(99);
    const tools = buildChatTools("alquilatucarro", LATEST); // no ctx
    await tools.crear_reserva.execute!(ARGS, { toolCallId: "t", messages: [] });
    expect(counts.countSuccessfulBookingsForConversation).not.toHaveBeenCalled();
    expect(runCrearReserva).toHaveBeenCalledOnce();
  });
});
