import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/render";
import { logNotification } from "@/lib/actions/notification-logs";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-confirmation";
import {
  sendReservationNotifications,
  isSafeMapUrl,
} from "@/lib/email/notifications";

vi.mock("@/lib/email/templates/reserved-confirmation", () => ({
  ReservedClientEmail: vi.fn(() => null),
}));

describe("isSafeMapUrl", () => {
  it("accepts a real maps.app.goo.gl shortlink", () => {
    expect(isSafeMapUrl("https://maps.app.goo.gl/yxKpFsswp4DKd6BL7")).toBe(true);
  });

  it("accepts a long www.google.com/maps URL", () => {
    expect(
      isSafeMapUrl(
        "https://www.google.com/maps/place/Aeropuerto+El+Dorado/@4.7016,-74.1469,15z"
      )
    ).toBe(true);
  });

  it("rejects javascript: URI (XSS)", () => {
    expect(isSafeMapUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects http:// (no TLS — MITM vector)", () => {
    expect(isSafeMapUrl("http://maps.app.goo.gl/x")).toBe(false);
  });

  it("rejects maps.app.goo.gl without trailing slash (no path)", () => {
    expect(isSafeMapUrl("https://maps.app.goo.gl")).toBe(false);
  });

  it("rejects host-smuggling: google.com/mapsX-evil", () => {
    expect(isSafeMapUrl("https://www.google.com/mapsX-evil")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeMapUrl("")).toBe(false);
  });
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/render", () => ({
  renderEmail: vi.fn().mockResolvedValue("<html>test</html>"),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
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
  total_insurance: false,
  extra_driver: false,
  baby_seat: false,
  wash: false,
  customers: {
    first_name: "Juan",
    last_name: "Perez",
    email: "juan@example.com",
    phone: "+573001234567",
  },
  pickup_location: {
    name: "Bogotá Aeropuerto",
    code: "AABOT",
    pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
    pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
  },
  return_location: {
    name: "Bogotá Aeropuerto",
    code: "AABOT",
    pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
    pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
    return_address: "Diagonal 24C, 99-45 - a 5 minutos del Aeropuerto" as string | null,
    return_map: "https://maps.app.goo.gl/JjpsSCHkCrgGYa9P7" as string | null,
  },
  categories: { name: "Gama C Económico" },
  monthly_mileage: null as number | null,
};

interface MockOpts {
  reservation?: typeof mockReservation;
  franchiseRow?: Record<string, unknown> | null;
}

// Routes `.from(table)` to per-table query results so the franchise lookup is
// distinguishable from the reservation lookup. The previous shared-mock setup
// returned the reservation object for every query, which masked franchise-row
// reads — those reads now drive Localiza BCC routing per SCEN-001..005.
function setupMock({ reservation = mockReservation, franchiseRow }: MockOpts = {}) {
  const defaultFranchise = {
    display_name: "Alquila tu Carro",
    phone: "+57 301 672 9250",
    whatsapp: "573016729250",
    logo_url: null,
    website: "https://alquilatucarro.com",
    localiza_bcc_email: "info@alquilatucarro.com",
  };
  const franchise = franchiseRow === undefined ? defaultFranchise : franchiseRow;

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: table === "franchises" ? franchise : reservation,
            error: null,
          }),
        }),
      }),
    })),
  } as unknown as ReturnType<typeof createAdminClient>);
}

describe("sendReservationNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMock();
    process.env.LOCALIZA_NOTIFICATION_EMAIL = "localiza@test.com";
    process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL = "fallback@test.com";
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
      expect.objectContaining({
        to: "localiza@test.com",
        subject: "Notificación de reserva en espera",
      })
    );
  });

  it("sends failed email to customer on status sin_disponibilidad", async () => {
    await sendReservationNotifications("res-123", "sin_disponibilidad", "alquilatucarro");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "juan@example.com", subject: "Reserva Sin Disponibilidad" })
    );
  });

  it("does not send emails for statuses without templates", async () => {
    await sendReservationNotifications("res-123", "utilizado", "alquilatucarro");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not write the _debug_commit_marker diagnostic row to notification_logs", async () => {
    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const markerCall = vi
      .mocked(logNotification)
      .mock.calls.find((c) => c[0].notification_type === "_debug_commit_marker");
    expect(markerCall).toBeUndefined();
  });

  // ─── Localiza BCC routing per franchise (SCEN-001..005) ─────────────

  // SCEN-001: alquilatucarro reservation with extras → BCC routes to alquilatucarro's mailbox.
  it("routes Localiza extras BCC to the franchise-specific mailbox (alquilatucarro)", async () => {
    setupMock({
      reservation: { ...mockReservation, baby_seat: true },
      franchiseRow: {
        display_name: "Alquila tu Carro",
        phone: "",
        whatsapp: null,
        logo_url: null,
        website: "https://alquilatucarro.com",
        localiza_bcc_email: "info@alquilatucarro.com",
      },
    });

    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const extrasCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con servicios adicionales");
    expect(extrasCall).toBeDefined();
    expect(extrasCall![0].bcc).toBe("info@alquilatucarro.com");
    expect(extrasCall![0].bcc).not.toBe("fallback@test.com");
  });

  // SCEN-002: alquilame reservation → BCC routes to alquilame's mailbox.
  it("routes Localiza seguro_total BCC to alquilame's mailbox for alquilame reservations", async () => {
    setupMock({
      reservation: { ...mockReservation, franchise: "alquilame", total_insurance: true },
      franchiseRow: {
        display_name: "Alquilame",
        phone: "",
        whatsapp: null,
        logo_url: null,
        website: "https://alquilame.co",
        localiza_bcc_email: "alquilamecol@gmail.com",
      },
    });

    await sendReservationNotifications("res-123", "reservado", "alquilame");

    const insuranceCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con seguro total");
    expect(insuranceCall).toBeDefined();
    expect(insuranceCall![0].bcc).toBe("alquilamecol@gmail.com");
  });

  // SCEN-003: NULL column → falls back to LOCALIZA_NOTIFICATION_BCC_EMAIL.
  it("falls back to LOCALIZA_NOTIFICATION_BCC_EMAIL when franchise localiza_bcc_email is NULL", async () => {
    setupMock({
      reservation: { ...mockReservation, total_insurance: true },
      franchiseRow: {
        display_name: "Alquila tu Carro",
        phone: "",
        whatsapp: null,
        logo_url: null,
        website: "https://alquilatucarro.com",
        localiza_bcc_email: null,
      },
    });

    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const insuranceCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con seguro total");
    expect(insuranceCall).toBeDefined();
    expect(insuranceCall![0].bcc).toBe("fallback@test.com");
  });

  // SCEN-003b: NULL column AND env var unset → no BCC field on the payload.
  it("omits BCC when both franchise column and env var are missing", async () => {
    delete process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL;
    setupMock({
      reservation: { ...mockReservation, total_insurance: true },
      franchiseRow: {
        display_name: "Alquila tu Carro",
        phone: "",
        whatsapp: null,
        logo_url: null,
        website: "https://alquilatucarro.com",
        localiza_bcc_email: null,
      },
    });

    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const insuranceCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con seguro total");
    expect(insuranceCall).toBeDefined();
    expect(insuranceCall![0].bcc).toBeUndefined();
  });

  // SCEN-004: All four Localiza notification types use the franchise BCC consistently.
  it("applies the franchise-specific BCC to all four Localiza notification types", async () => {
    const sharedFranchise = {
      display_name: "Alquicarros",
      phone: "",
      whatsapp: null,
      logo_url: null,
      website: "https://alquicarros.com",
      localiza_bcc_email: "alquicarroscolombia@gmail.com",
    };

    // pendiente_localiza
    setupMock({
      reservation: { ...mockReservation, franchise: "alquicarros" },
      franchiseRow: sharedFranchise,
    });
    await sendReservationNotifications("res-123", "pendiente", "alquicarros");
    const pendingLocaliza = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva en espera");
    expect(pendingLocaliza?.[0].bcc).toBe("alquicarroscolombia@gmail.com");

    // seguro_total_localiza
    vi.clearAllMocks();
    setupMock({
      reservation: { ...mockReservation, franchise: "alquicarros", total_insurance: true },
      franchiseRow: sharedFranchise,
    });
    await sendReservationNotifications("res-123", "reservado", "alquicarros");
    const insurance = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con seguro total");
    expect(insurance?.[0].bcc).toBe("alquicarroscolombia@gmail.com");

    // extras_localiza
    vi.clearAllMocks();
    setupMock({
      reservation: { ...mockReservation, franchise: "alquicarros", baby_seat: true },
      franchiseRow: sharedFranchise,
    });
    await sendReservationNotifications("res-123", "reservado", "alquicarros");
    const extras = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva con servicios adicionales");
    expect(extras?.[0].bcc).toBe("alquicarroscolombia@gmail.com");

    // mensualidad_localiza
    vi.clearAllMocks();
    setupMock({
      reservation: { ...mockReservation, franchise: "alquicarros", monthly_mileage: 2000 },
      franchiseRow: sharedFranchise,
    });
    await sendReservationNotifications("res-123", "mensualidad", "alquicarros");
    const monthly = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Notificación de reserva mensual");
    expect(monthly?.[0].bcc).toBe("alquicarroscolombia@gmail.com");
  });

  // SCEN-005: Non-Localiza notifications carry no BCC.
  it("does not attach the franchise BCC to customer-facing notifications", async () => {
    setupMock({
      franchiseRow: {
        display_name: "Alquila tu Carro",
        phone: "",
        whatsapp: null,
        logo_url: null,
        website: "https://alquilatucarro.com",
        localiza_bcc_email: "info@alquilatucarro.com",
      },
    });

    await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

    const reservedCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].subject === "Reserva Aprobada");
    expect(reservedCall).toBeDefined();
    expect(reservedCall![0].bcc).toBeUndefined();
  });

  // ─── Reserved email pickup/return address + map props (Step 3/5) ────

  describe("reserved email — pickup/return address+map props", () => {
    function lastReservedEmailProps() {
      const calls = vi.mocked(ReservedClientEmail).mock.calls;
      return (calls[calls.length - 1]?.[0] ?? {}) as unknown as Record<
        string,
        unknown
      >;
    }

    it("scenario 1: passes pickup address+map and falls back to pickup for return when same location with no return_* override", async () => {
      setupMock({
        reservation: {
          ...mockReservation,
          pickup_location: {
            name: "Bogotá Aeropuerto",
            code: "AABOT",
            pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
            pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
          },
          return_location: {
            name: "Bogotá Aeropuerto",
            code: "AABOT",
            pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
            pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
            return_address: null,
            return_map: null,
          },
        },
      });

      await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

      const props = lastReservedEmailProps();
      expect(props.pickupAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.pickupMapUrl).toBe("https://maps.app.goo.gl/U3Sct9jNM8BrLFR78");
      expect(props.returnAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.returnMapUrl).toBe("https://maps.app.goo.gl/U3Sct9jNM8BrLFR78");
    });

    it("scenario 2: uses return_* override when return location has both return_address AND return_map populated", async () => {
      // Default mockReservation has both override fields populated
      await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

      const props = lastReservedEmailProps();
      expect(props.pickupAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.pickupMapUrl).toBe("https://maps.app.goo.gl/U3Sct9jNM8BrLFR78");
      expect(props.returnAddress).toBe("Diagonal 24C, 99-45 - a 5 minutos del Aeropuerto");
      expect(props.returnMapUrl).toBe("https://maps.app.goo.gl/JjpsSCHkCrgGYa9P7");
    });

    it("scenario 4: atomic fallback when return_address is set but return_map is null (mixed-null pair rejected)", async () => {
      setupMock({
        reservation: {
          ...mockReservation,
          return_location: {
            name: "Bogotá Aeropuerto",
            code: "AABOT",
            pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
            pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
            return_address: "Diagonal 24C, 99-45 - a 5 minutos del Aeropuerto",
            return_map: null,
          },
        },
      });

      await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

      const props = lastReservedEmailProps();
      expect(props.returnAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.returnMapUrl).toBe("https://maps.app.goo.gl/U3Sct9jNM8BrLFR78");
    });

    it("scenario 4 (inverse): atomic fallback when return_map is set but return_address is null", async () => {
      setupMock({
        reservation: {
          ...mockReservation,
          return_location: {
            name: "Bogotá Aeropuerto",
            code: "AABOT",
            pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
            pickup_map: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
            return_address: null,
            return_map: "https://maps.app.goo.gl/JjpsSCHkCrgGYa9P7",
          },
        },
      });

      await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

      const props = lastReservedEmailProps();
      expect(props.returnAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.returnMapUrl).toBe("https://maps.app.goo.gl/U3Sct9jNM8BrLFR78");
    });

    it("scenario 5: rejects malformed pickup_map and warns with location code + rejected URL", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      setupMock({
        reservation: {
          ...mockReservation,
          pickup_location: {
            name: "Bogotá Aeropuerto",
            code: "AABOT",
            pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
            pickup_map: "javascript:alert(1)",
          },
        },
      });

      await sendReservationNotifications("res-123", "reservado", "alquilatucarro");

      const props = lastReservedEmailProps();
      expect(props.pickupAddress).toBe("Aeropuerto El Dorado, Piso 1 Puerta 7");
      expect(props.pickupMapUrl).toBeUndefined();

      const warnPayload = warnSpy.mock.calls.flat().join(" ");
      expect(warnPayload).toContain("AABOT");
      expect(warnPayload).toContain("javascript:alert(1)");

      warnSpy.mockRestore();
    });
  });
});
