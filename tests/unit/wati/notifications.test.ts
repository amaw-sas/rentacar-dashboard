import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { addContact, sendTemplateMessage } from "@/lib/wati/client";
import { sendStatusWhatsApp, MESSAGE_SPACING_MS } from "@/lib/wati/notifications";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/wati/client", () => ({
  addContact: vi.fn().mockResolvedValue(undefined),
  sendTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
}));

const mockReservation = {
  id: "res-123",
  franchise: "alquilatucarro",
  reservation_code: "AV78XC3JDA",
  pickup_date: "2026-04-15",
  pickup_hour: "09:00",
  return_date: "2026-04-20",
  return_hour: "09:00",
  total_insurance: false,
  extra_driver: false,
  baby_seat: false,
  wash: false,
  customers: {
    first_name: "Juan",
    last_name: "Perez",
    phone: "+573001234567",
  },
  pickup_location: { name: "Bogotá Aeropuerto", address: "Av El Dorado" },
  return_location: { name: "Bogotá Aeropuerto", address: "Av El Dorado" },
};

function setupMock(reservation = mockReservation) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: reservation, error: null }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createAdminClient>);
}

/**
 * Drives an async dispatch that awaits real `setTimeout` spacing between sends,
 * without waiting in wall-clock time. Returns how many spacing timers
 * (`MESSAGE_SPACING_MS`) were scheduled — the observable for the "spaced sends" intent.
 */
async function runDispatch(
  fn: () => Promise<void>
): Promise<{ spacingTimers: number }> {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const promise = fn();
  await vi.runAllTimersAsync();
  await promise;
  const spacingTimers = setTimeoutSpy.mock.calls.filter(
    (call) => call[1] === MESSAGE_SPACING_MS
  ).length;
  setTimeoutSpy.mockRestore();
  vi.useRealTimers();
  return { spacingTimers };
}

describe("sendStatusWhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // SCEN-001: reservado sends the three templates in correct order, spaced.
  it("sends the three reservado templates in exact order with spacing between them", async () => {
    const { spacingTimers } = await runDispatch(() =>
      sendStatusWhatsApp("res-123", "reservado")
    );

    const templateNames = vi
      .mocked(sendTemplateMessage)
      .mock.calls.map((call) => call[1]);

    expect(templateNames).toEqual([
      "nueva_reserva_5",
      "nueva_reserva_instrucciones_2",
      "nueva_reserva_instrucciones_adicionales",
    ]);

    // One spacing delay awaited before each of the two extra sends.
    expect(spacingTimers).toBe(2);
    expect(MESSAGE_SPACING_MS).toBeGreaterThan(0);
  });

  it("sends nueva_reserva_5 with reservation params for status reservado", async () => {
    await runDispatch(() => sendStatusWhatsApp("res-123", "reservado"));

    expect(addContact).toHaveBeenCalledWith("+573001234567", "Juan Perez");
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "nueva_reserva_5",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ name: "fullname", value: "Juan Perez" }),
        expect.objectContaining({ name: "reservation_code", value: "AV78XC3JDA" }),
      ])
    );
  });

  // SCEN-002: statuses without extras send a single message and add no spacing delay.
  it("sends reserva_pendiente once with no spacing delay for status pendiente", async () => {
    const { spacingTimers } = await runDispatch(() =>
      sendStatusWhatsApp("res-123", "pendiente")
    );

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "reserva_pendiente",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ name: "fullname", value: "Juan Perez" }),
      ])
    );
    expect(spacingTimers).toBe(0);
  });

  it("sends reserva_sin_disponibilidad for status sin_disponibilidad", async () => {
    await runDispatch(() => sendStatusWhatsApp("res-123", "sin_disponibilidad"));

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "reserva_sin_disponibilidad",
      expect.any(String),
      expect.any(Array)
    );
  });

  it("does not send for statuses without templates", async () => {
    await runDispatch(() => sendStatusWhatsApp("res-123", "utilizado"));

    expect(addContact).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("skips if customer has no phone", async () => {
    setupMock({
      ...mockReservation,
      customers: { ...mockReservation.customers, phone: "" },
    });

    await runDispatch(() => sendStatusWhatsApp("res-123", "reservado"));

    expect(addContact).not.toHaveBeenCalled();
  });
});
