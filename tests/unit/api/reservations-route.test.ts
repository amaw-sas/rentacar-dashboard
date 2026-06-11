import { describe, it, expect, vi, beforeEach } from "vitest";

// SCEN-002: the public reservations API freezes a customer snapshot onto the
// inserted reservation (issue #26). The snapshot must reflect the RESOLVED
// customer row that `customer_id` points to — NOT the raw request body.
//
// Anti-gaming core: under #25 lenient findOrCreateCustomer, a CC-collision
// returns an EXISTING customer whose stored data differs from the submitted
// body. The snapshot must equal the stored row (the FK target), proving the
// route reads the customer via snapshotFromCustomer rather than echoing input.

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/api/resolve-references", () => ({
  resolveLocationByCode: vi.fn(),
  findOrCreateCustomer: vi.fn(),
  resolveReferral: vi.fn(),
}));
vi.mock("@/lib/queries/customers", () => ({ snapshotFromCustomer: vi.fn() }));
vi.mock("@/lib/api/normalize-identification-type", () => ({
  normalizeIdentificationType: vi.fn((t: string) => t),
}));
vi.mock("@/lib/email/notifications", () => ({
  sendReservationNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wati/notifications", () => ({
  sendStatusWhatsApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ghl/sync", () => ({
  syncReservationToGhl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/reservation/mileage-parser", () => ({
  parseMonthlyMileage: vi.fn(() => null),
}));
// `after` callback would dispatch WhatsApp/GHL — run it inert (no-op) so the
// test isolates the insert payload, not the post-response fan-out.
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
  after: vi.fn(),
}));

/**
 * Chainable Supabase admin stub for the insert path:
 *   from("reservations").insert(payload).select("id").single()
 * Captures the insert payload for assertion.
 */
function makeAdminClient() {
  const single = vi.fn().mockResolvedValue({ data: { id: "res-new" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown, from, insert };
}

// Monthly reservation (selected_days >= 30) skips the Localiza proxy fetch,
// exercising the insert directly without stubbing global fetch.
const REQUEST_BODY = {
  fullname: "Body Name Distinta",
  identification_type: "CC",
  identification: "999999999",
  phone: "+570000000000",
  email: "body@example.com",
  category: "ECON",
  pickup_location: "BOG01",
  return_location: "BOG01",
  pickup_date: "2026-07-01",
  pickup_hour: "10:00",
  return_date: "2026-08-01",
  return_hour: "10:00",
  selected_days: 30,
  total_price: 1000,
  total_price_to_pay: 1000,
  franchise: "alquilatucarro",
};

function makeRequest(body: unknown) {
  return {
    headers: { get: (k: string) => (k === "x-api-key" ? "test-key" : null) },
    json: async () => body,
  } as unknown as Request;
}

describe("POST /api/reservations — customer snapshot (SCEN-002)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESERVATION_API_KEY = "test-key";
  });

  it("freezes the snapshot from the RESOLVED customer row, not the request body (CC-collision anti-gaming)", async () => {
    const { resolveLocationByCode, findOrCreateCustomer, resolveReferral } =
      await import("@/lib/api/resolve-references");
    const { snapshotFromCustomer } = await import("@/lib/queries/customers");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(resolveLocationByCode).mockResolvedValue({
      id: "loc-1",
      rental_company_id: "rc-1",
    } as Awaited<ReturnType<typeof resolveLocationByCode>>);
    // #25 lenient collision: returns an EXISTING customer id (not a new one).
    vi.mocked(findOrCreateCustomer).mockResolvedValue("existing-cust-id");
    vi.mocked(resolveReferral).mockResolvedValue(null);

    // The stored customer row differs from REQUEST_BODY on every identity field.
    vi.mocked(snapshotFromCustomer).mockResolvedValue({
      customer_name_at_booking: "Stored Owner",
      customer_email_at_booking: "stored@example.com",
      customer_phone_at_booking: "+573001112233",
      customer_identification_type_at_booking: "CC",
      customer_identification_number_at_booking: "123456",
    });

    const sb = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(
      sb.client as ReturnType<typeof createAdminClient>,
    );

    const { POST } = await import("@/app/api/reservations/route");
    const res = (await POST(makeRequest(REQUEST_BODY))) as { status: number };

    expect(res.status).toBe(200);

    // snapshotFromCustomer was called with the admin client + the RESOLVED id.
    expect(snapshotFromCustomer).toHaveBeenCalledWith(sb.client, "existing-cust-id");

    const payload = sb.insert.mock.calls[0][0];
    expect(payload.customer_id).toBe("existing-cust-id");
    // The 5 snapshot fields equal the CUSTOMER ROW, never the request body.
    expect(payload.customer_name_at_booking).toBe("Stored Owner");
    expect(payload.customer_email_at_booking).toBe("stored@example.com");
    expect(payload.customer_phone_at_booking).toBe("+573001112233");
    expect(payload.customer_identification_type_at_booking).toBe("CC");
    expect(payload.customer_identification_number_at_booking).toBe("123456");
    // Explicitly assert it did NOT echo the submitted body.
    expect(payload.customer_name_at_booking).not.toBe("Body Name Distinta");
    expect(payload.customer_email_at_booking).not.toBe("body@example.com");
  });
});

// Issue #113: the route derives a marketing channel from the optional
// `attribution` object and persists the 8 raw signals + derived channel.
// Executes the REAL POST handler (monthly booking skips Localiza) and inspects
// the captured insert payload — proves the route wiring, not just the DB layer.
describe("POST /api/reservations — attribution channel (issue #113, SCEN-005/006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESERVATION_API_KEY = "test-key";
  });

  async function postWith(bodyExtra: Record<string, unknown>) {
    const { resolveLocationByCode, findOrCreateCustomer, resolveReferral } =
      await import("@/lib/api/resolve-references");
    const { snapshotFromCustomer } = await import("@/lib/queries/customers");
    const { createAdminClient } = await import("@/lib/supabase/admin");

    vi.mocked(resolveLocationByCode).mockResolvedValue({
      id: "loc-1",
      rental_company_id: "rc-1",
    } as Awaited<ReturnType<typeof resolveLocationByCode>>);
    vi.mocked(findOrCreateCustomer).mockResolvedValue("cust-1");
    vi.mocked(resolveReferral).mockResolvedValue(null);
    vi.mocked(snapshotFromCustomer).mockResolvedValue({
      customer_name_at_booking: "X",
      customer_email_at_booking: "x@e.com",
      customer_phone_at_booking: "1",
      customer_identification_type_at_booking: "CC",
      customer_identification_number_at_booking: "1",
    });

    const sb = makeAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(
      sb.client as ReturnType<typeof createAdminClient>,
    );

    const { POST } = await import("@/app/api/reservations/route");
    const res = (await POST(makeRequest({ ...REQUEST_BODY, ...bodyExtra }))) as {
      status: number;
      body: unknown;
    };
    return { res, payload: sb.insert.mock.calls[0]?.[0] };
  }

  const ATTRIBUTION_COLUMNS = [
    "utm_source",
    "utm_medium",
    "gclid",
    "gad_source",
    "fbclid",
    "ttclid",
    "msclkid",
    "landing_referrer",
    "attribution_channel",
  ];

  it("SCEN-005: attribution {gclid} → derives google_ads and persists the gclid", async () => {
    const { res, payload } = await postWith({ attribution: { gclid: "Cj0KCQ-x" } });
    expect(res.status).toBe(200);
    expect(payload.attribution_channel).toBe("google_ads");
    expect(payload.gclid).toBe("Cj0KCQ-x");
  });

  it("SCEN-006: no attribution → all 9 columns null and response shape unchanged", async () => {
    const { res, payload } = await postWith({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reserveCode: "res-new",
      reservationStatus: "mensualidad",
    });
    for (const col of ATTRIBUTION_COLUMNS) {
      expect(payload[col]).toBeNull();
    }
  });

  it("empty attribution {} → 'direct' (Directo, not Desconocido)", async () => {
    const { payload } = await postWith({ attribution: {} });
    expect(payload.attribution_channel).toBe("direct");
  });

  it("referrer input maps to the landing_referrer column and derives referral", async () => {
    const { payload } = await postWith({
      attribution: { referrer: "https://www.google.com/" },
    });
    expect(payload.landing_referrer).toBe("https://www.google.com/");
    expect(payload.attribution_channel).toBe("referral");
  });

  it("malformed attribution (non-object) never blocks the booking → channel null", async () => {
    const { res, payload } = await postWith({ attribution: "not-an-object" });
    expect(res.status).toBe(200);
    expect(payload.attribution_channel).toBeNull();
  });
});
