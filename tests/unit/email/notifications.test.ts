import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/render";
import { sendReservationNotifications } from "@/lib/email/notifications";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/render", () => ({
  renderEmail: vi.fn().mockResolvedValue("<html>test</html>"),
}));

const mockReservation = {
  id: "res-123",
  franchise: "alquilatucarro",
  reservation_code: "AV78XC3JDA",
  category_code: "C",
  pickup_date: "2026-04-15",
  pickup_hour: "09:00",
  return_date: "2026-04-20",
  return_hour: "09:00",
  selected_days: 5,
  total_price: 400000,
  total_price_to_pay: 476000,
  tax_fee: 40000,
  iva_fee: 36000,
  total_insurance: 0,
  extra_driver: false,
  baby_seat: false,
  wash: false,
  customers: {
    first_name: "Juan",
    last_name: "Perez",
    email: "juan@example.com",
    phone: "+573001234567",
  },
  pickup_location: { name: "Bogotá Aeropuerto" },
  return_location: { name: "Bogotá Aeropuerto" },
  categories: { name: "Gama C Económico" },
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

describe("sendReservationNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
    process.env.LOCALIZA_NOTIFICATION_EMAIL = "localiza@test.com";
    process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL = "bcc@test.com";
  });

  it("sends reserved email to customer on status reservado", async () => {
    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    expect(renderEmail).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        franchise: "alquilatucarro",
        to: "juan@example.com",
        subject: "Reserva Aprobada",
      })
    );
  });

  it("sends pending email to customer + notification to Localiza on status pendiente", async () => {
    await sendReservationNotifications("res-123", "pendiente", "alquilatucarro");

    const calls = vi.mocked(sendEmail).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][0]).toEqual(
      expect.objectContaining({ to: "juan@example.com", subject: "Reserva Pendiente" })
    );
    expect(calls[1][0]).toEqual(
      expect.objectContaining({ to: "localiza@test.com", subject: "Notificación de reserva en espera", bcc: "bcc@test.com" })
    );
  });

  it("sends failed email to customer on status sin_disponibilidad", async () => {
    await sendReservationNotifications("res-123", "sin_disponibilidad", "alquilatucarro");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "juan@example.com", subject: "Reserva Sin Disponibilidad" })
    );
  });

  it("sends total insurance notification to Localiza when total_insurance > 0", async () => {
    setupMock({ ...mockReservation, total_insurance: 45000 });

    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const calls = vi.mocked(sendEmail).mock.calls;
    const insuranceCall = calls.find((c) => c[0].subject === "Notificación de reserva con seguro total");
    expect(insuranceCall).toBeDefined();
    expect(insuranceCall![0].to).toBe("localiza@test.com");
    expect(insuranceCall![0].bcc).toBe("bcc@test.com");
  });

  it("does not send emails for statuses without templates", async () => {
    await sendReservationNotifications("res-123", "utilizado", "alquilatucarro");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
