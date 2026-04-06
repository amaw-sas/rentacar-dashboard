import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { addContact, sendTemplateMessage } from "@/lib/wati/client";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/wati/client", () => ({
  addContact: vi.fn().mockResolvedValue(undefined),
  sendTemplateMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockReservation = {
  id: "res-123",
  franchise: "alquilatucarro",
  reservation_code: "AV78XC3JDA",
  pickup_date: "2026-04-15",
  pickup_hour: "09:00",
  return_date: "2026-04-20",
  return_hour: "09:00",
  total_insurance: 0,
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
  vi.mocked(createClient).mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: reservation, error: null }),
        }),
      }),
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("sendStatusWhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
  });

  it("sends nueva_reserva_5 template for status reservado", async () => {
    await sendStatusWhatsApp("res-123", "reservado");

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

  it("sends additional instruction templates for reservado", async () => {
    await sendStatusWhatsApp("res-123", "reservado");

    const calls = vi.mocked(sendTemplateMessage).mock.calls;
    const templateNames = calls.map((c) => c[1]);
    expect(templateNames).toContain("nueva_reserva_instrucciones_2");
    expect(templateNames).toContain("nueva_reserva_instrucciones_adicionales");
  });

  it("sends reserva_pendiente template for status pendiente", async () => {
    await sendStatusWhatsApp("res-123", "pendiente");

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "reserva_pendiente",
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ name: "fullname", value: "Juan Perez" }),
      ])
    );
  });

  it("sends reserva_sin_disponibilidad for status sin_disponibilidad", async () => {
    await sendStatusWhatsApp("res-123", "sin_disponibilidad");

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      "+573001234567",
      "reserva_sin_disponibilidad",
      expect.any(String),
      expect.any(Array)
    );
  });

  it("does not send for statuses without templates", async () => {
    await sendStatusWhatsApp("res-123", "utilizado");

    expect(addContact).not.toHaveBeenCalled();
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("skips if customer has no phone", async () => {
    setupMock({ ...mockReservation, customers: { ...mockReservation.customers, phone: "" } });

    await sendStatusWhatsApp("res-123", "reservado");

    expect(addContact).not.toHaveBeenCalled();
  });
});
