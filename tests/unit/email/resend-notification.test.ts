import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/render";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-confirmation";
import { resendEmailNotification } from "@/lib/email/notifications";

// Match the mocking style of notifications.test.ts: stub createAdminClient,
// sendEmail, renderEmail, fetchLogoAttachment, logNotification and the templates
// we assert against so we observe the props they received.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/fetch-logo", () => ({
  fetchLogoAttachment: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/email/render", () => ({
  renderEmail: vi.fn(),
}));

vi.mock("@/lib/actions/notification-logs", () => ({
  logNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email/templates/reserved-confirmation", () => ({
  ReservedClientEmail: vi.fn(() => null),
}));

const baseReservation = {
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
    return_address: null as string | null,
    return_map: null as string | null,
  },
  monthly_mileage: 2000 as number | null,
};

const defaultFranchise = {
  display_name: "Alquila tu Carro",
  phone: "+57 301 672 9250",
  whatsapp: "573016729250",
  logo_url: null,
  website: "https://alquilatucarro.com",
  localiza_bcc_email: "info@alquilatucarro.com",
};

function setupMock(reservation: Record<string, unknown> = baseReservation) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: table === "franchises" ? defaultFranchise : reservation,
            error: null,
          }),
        }),
      }),
    })),
  } as unknown as ReturnType<typeof createAdminClient>);
}

describe("resendEmailNotification (issue #87)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(renderEmail).mockResolvedValue("<html>fresh-render</html>");
    process.env.LOCALIZA_NOTIFICATION_EMAIL = "localiza@test.com";
    process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL = "fallback@test.com";
  });

  // SCEN-1: resending uses the CURRENT pickup location, not whatever the
  // original frozen log captured. The template mock must receive the current
  // location, and sendEmail must carry the freshly rendered html.
  it("SCEN-1: re-renders with the CURRENT pickup location, not a frozen snapshot", async () => {
    setupMock({
      ...baseReservation,
      pickup_location: {
        name: "Medellín Aeropuerto",
        code: "MDEAP",
        pickup_address: "Aeropuerto José María Córdova",
        pickup_map: "https://maps.app.goo.gl/currentMedellinXYZ",
      },
    });
    vi.mocked(renderEmail).mockResolvedValue("<html>medellin-current</html>");

    const res = await resendEmailNotification("res-123", "reservado_cliente", "alquilatucarro");

    expect(res).toEqual({ ok: true });

    const props = vi.mocked(ReservedClientEmail).mock.calls.at(-1)?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(props.pickupLocation).toBe("Medellín Aeropuerto");
    expect(props.pickupAddress).toBe("Aeropuerto José María Córdova");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<html>medellin-current</html>" })
    );
  });

  // SCEN-2: resending mensualidad_cliente fires exactly ONE email, addressed to
  // the customer, with the _reenvio suffix — and NO localiza sibling is sent.
  it("SCEN-2: mensualidad_cliente sends one email to the customer, no localiza sibling", async () => {
    setupMock();

    const res = await resendEmailNotification("res-123", "mensualidad_cliente", "alquilatucarro");

    expect(res).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.notificationType).toBe("mensualidad_cliente_reenvio");
    expect(call.to).toBe("juan@example.com");

    const localizaCall = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0].to === "localiza@test.com");
    expect(localizaCall).toBeUndefined();
  });

  // SCEN-3: notificationType ends with _reenvio and the send path is exercised
  // (sendEmail invoked, which is what triggers the sent log downstream).
  it("SCEN-3: resent notificationType ends with _reenvio", async () => {
    setupMock();

    await resendEmailNotification("res-123", "reservado_cliente", "alquilatucarro");

    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.notificationType?.endsWith("_reenvio")).toBe(true);
    expect(call.notificationType).toBe("reservado_cliente_reenvio");
  });

  // SCEN-4: recipient equals the customer's CURRENT email from live data.
  it("SCEN-4: to equals the customer's CURRENT email", async () => {
    setupMock({
      ...baseReservation,
      customers: {
        first_name: "Juan",
        last_name: "Perez",
        email: "nuevo-correo@example.com",
        phone: "+573001234567",
      },
    });

    await resendEmailNotification("res-123", "reservado_cliente", "alquilatucarro");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "nuevo-correo@example.com" })
    );
  });

  // SCEN-6: unknown/legacy type → reason "unknown_type" (caller may replay the
  // stored snapshot), never sends from the live path.
  it("SCEN-6: unknown/legacy notification_type returns reason unknown_type without sending", async () => {
    setupMock();

    const res = await resendEmailNotification(
      "res-123",
      "whatsapp_reservado",
      "alquilatucarro"
    );

    expect(res).toEqual({ ok: false, reason: "unknown_type" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // A known localiza type with LOCALIZA_NOTIFICATION_EMAIL unset → reason
  // "not_renderable" (NOT unknown_type): the caller must surface an error, not
  // replay a stale snapshot to the old Localiza address.
  it("returns reason not_renderable for a localiza type when LOCALIZA_NOTIFICATION_EMAIL is unset", async () => {
    delete process.env.LOCALIZA_NOTIFICATION_EMAIL;
    setupMock();

    const res = await resendEmailNotification(
      "res-123",
      "pendiente_localiza",
      "alquilatucarro"
    );

    expect(res).toEqual({ ok: false, reason: "not_renderable" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // Live data incomplete (customer hard-deleted) → reason "not_renderable",
  // never throws a raw TypeError, never sends.
  it("returns reason not_renderable when the customer relation is null", async () => {
    setupMock({ ...baseReservation, customers: null });

    const res = await resendEmailNotification(
      "res-123",
      "reservado_cliente",
      "alquilatucarro"
    );

    expect(res).toEqual({ ok: false, reason: "not_renderable" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
