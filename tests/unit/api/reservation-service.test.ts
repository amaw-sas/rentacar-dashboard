import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Issue #72 Step 3: the reservation-creation core is extracted to
// `createReservation` (lib/api/reservation-service.ts) so an in-process MCP
// server can call it directly. These tests encode the holdout scenarios
// SCEN-005..009 against the SERVICE. The public-route contract is independently
// locked by reservations-route.test.ts (unchanged).
//
// Same dispatch-by-table mocking pattern as the route test: admin client,
// resolve-references, customer snapshot, notifications and `next/server`
// (`after` inert) are all mocked.

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
// `after` runs the WhatsApp/GHL fan-out — keep it inert so the test isolates
// the insert path. `next/server` must stay imported by the service.
vi.mock("next/server", () => ({
  after: vi.fn(),
}));

// NOTE: `vi.resetModules()` in beforeEach gives each dynamically-imported
// service its own fresh module graph — so `ServiceError` must be imported
// dynamically ALONGSIDE the service (same graph) for `instanceof` to hold.

function makeAdminClient() {
  const single = vi.fn().mockResolvedValue({ data: { id: "res-new" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown, from, insert };
}

const MONTHLY_INPUT = {
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

const STANDARD_INPUT = {
  ...MONTHLY_INPUT,
  selected_days: 4,
  return_date: "2026-07-05",
  reference_token: "tok-abc",
  rate_qualifier: "RQ1",
};

async function wireMocks(opts?: {
  customerId?: string;
  snapshot?: Awaited<ReturnType<typeof import("@/lib/queries/customers").snapshotFromCustomer>>;
}) {
  const { resolveLocationByCode, findOrCreateCustomer, resolveReferral } =
    await import("@/lib/api/resolve-references");
  const { snapshotFromCustomer } = await import("@/lib/queries/customers");
  const { createAdminClient } = await import("@/lib/supabase/admin");

  vi.mocked(resolveLocationByCode).mockResolvedValue({
    id: "loc-1",
    rental_company_id: "rc-1",
  } as Awaited<ReturnType<typeof resolveLocationByCode>>);
  vi.mocked(findOrCreateCustomer).mockResolvedValue(
    opts?.customerId ?? "cust-1",
  );
  vi.mocked(resolveReferral).mockResolvedValue(null);
  vi.mocked(snapshotFromCustomer).mockResolvedValue(
    opts?.snapshot ?? {
      customer_name_at_booking: "X",
      customer_email_at_booking: "x@e.com",
      customer_phone_at_booking: "1",
      customer_identification_type_at_booking: "CC",
      customer_identification_number_at_booking: "1",
    },
  );

  const sb = makeAdminClient();
  vi.mocked(createAdminClient).mockReturnValue(
    sb.client as ReturnType<typeof createAdminClient>,
  );
  return { sb, snapshotFromCustomer };
}

function proxyResponse(opts: {
  ok: boolean;
  status: number;
  json?: () => unknown;
  text?: () => string;
}) {
  return {
    ok: opts.ok,
    status: opts.status,
    json: async () => (opts.json ? opts.json() : undefined),
    text: async () => (opts.text ? opts.text() : ""),
  };
}

describe("createReservation (issue #72 Step 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LOCALIZA_PROXY_URL = "https://proxy.test";
    process.env.PROXY_API_KEY = "proxy-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // SCEN-005 — standard success returns { reserveCode, reservationStatus }
  // mapped from Localiza ("Reserved" → "reservado").
  it("SCEN-005: standard reservation returns mapped reserveCode + reservationStatus", async () => {
    const { sb } = await wireMocks();
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: true,
        status: 200,
        json: () => ({ reserveCode: "LOC-123", reservationStatus: "Reserved" }),
      }) as Response,
    );

    const { createReservation } = await import("@/lib/api/reservation-service");
    const result = await createReservation(STANDARD_INPUT);

    expect(result).toEqual({
      reserveCode: "LOC-123",
      reservationStatus: "reservado",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = sb.insert.mock.calls[0][0];
    expect(payload.status).toBe("reservado");
    expect(payload.reservation_code).toBe("LOC-123");
    expect(payload.booking_type).toBe("standard");
  });

  // SCEN-006 — standard without token/qualifier → ServiceError(400) exact msg,
  // no proxy call.
  it("SCEN-006: standard without reference_token throws ServiceError(400) and skips the proxy", async () => {
    await wireMocks();
    const { reference_token: _omit, ...noToken } = STANDARD_INPUT;
    void _omit;

    const { createReservation } = await import("@/lib/api/reservation-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await createReservation(noToken).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;

    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(400);
    expect(err.payload).toEqual({
      error: "reference_token y rate_qualifier son requeridos para reservas estándar",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("SCEN-006: standard without rate_qualifier throws ServiceError(400)", async () => {
    await wireMocks();
    const { rate_qualifier: _omit, ...noQualifier } = STANDARD_INPUT;
    void _omit;

    const { createReservation } = await import("@/lib/api/reservation-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await createReservation(noQualifier).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;

    expect(err.status).toBe(400);
    expect(err.payload).toEqual({
      error: "reference_token y rate_qualifier son requeridos para reservas estándar",
    });
  });

  // SCEN-007 — structured proxy error passthrough as ServiceError(status, fullPayload).
  it("SCEN-007: structured proxy error → ServiceError with full payload + proxy status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await wireMocks();
    const envelope = {
      error: "localiza_business_error",
      message: "Sin inventario",
      shortText: "LLNRAG009",
    };
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 422,
        text: () => JSON.stringify(envelope),
      }) as Response,
    );

    const { createReservation } = await import("@/lib/api/reservation-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await createReservation(STANDARD_INPUT).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;

    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(422);
    expect(err.payload).toEqual(envelope);
    errorSpy.mockRestore();
  });

  // Non-parseable proxy error → generic ServiceError(502).
  it("non-JSON proxy error → ServiceError(502) generic", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await wireMocks();
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: false,
        status: 500,
        text: () => "<html>Bad Gateway</html>",
      }) as Response,
    );

    const { createReservation } = await import("@/lib/api/reservation-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await createReservation(STANDARD_INPUT).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;

    expect(err.status).toBe(502);
    expect(typeof (err.payload as { error: string }).error).toBe("string");
    errorSpy.mockRestore();
  });

  // SCEN-008 — existing customer NOT mutated; snapshot from stored row.
  it("SCEN-008: snapshot reflects the resolved customer row, never the input body", async () => {
    const { sb, snapshotFromCustomer } = await wireMocks({
      customerId: "existing-cust-id",
      snapshot: {
        customer_name_at_booking: "Stored Owner",
        customer_email_at_booking: "stored@example.com",
        customer_phone_at_booking: "+573001112233",
        customer_identification_type_at_booking: "CC",
        customer_identification_number_at_booking: "123456",
      },
    });
    vi.mocked(fetch).mockResolvedValue(
      proxyResponse({
        ok: true,
        status: 200,
        json: () => ({ reserveCode: "LOC-9", reservationStatus: "Reserved" }),
      }) as Response,
    );

    const { createReservation } = await import("@/lib/api/reservation-service");
    await createReservation(STANDARD_INPUT);

    expect(snapshotFromCustomer).toHaveBeenCalledWith(
      sb.client,
      "existing-cust-id",
    );
    const payload = sb.insert.mock.calls[0][0];
    expect(payload.customer_id).toBe("existing-cust-id");
    expect(payload.customer_name_at_booking).toBe("Stored Owner");
    expect(payload.customer_email_at_booking).toBe("stored@example.com");
    expect(payload.customer_phone_at_booking).toBe("+573001112233");
    expect(payload.customer_identification_number_at_booking).toBe("123456");
    // Never the input body.
    expect(payload.customer_name_at_booking).not.toBe("Body Name Distinta");
    expect(payload.customer_email_at_booking).not.toBe("body@example.com");
  });

  // SCEN-009 — monthly (selected_days >= 30) skips proxy, status mensualidad,
  // reserveCode falls back to inserted id.
  it("SCEN-009: monthly reservation skips the proxy and returns status mensualidad", async () => {
    const { sb } = await wireMocks();

    const { createReservation } = await import("@/lib/api/reservation-service");
    const result = await createReservation(MONTHLY_INPUT);

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      reserveCode: "res-new",
      reservationStatus: "mensualidad",
    });
    const payload = sb.insert.mock.calls[0][0];
    expect(payload.status).toBe("mensualidad");
    expect(payload.booking_type).toBe("monthly");
    expect(payload.reservation_code).toBeNull();
  });

  // Insert failure → ServiceError(500).
  it("insert failure → ServiceError(500)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sb } = await wireMocks();
    sb.insert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "boom" } }),
      }),
    });

    const { createReservation } = await import("@/lib/api/reservation-service");
    const { ServiceError } = await import("@/lib/api/service-error");
    const err = (await createReservation(MONTHLY_INPUT).catch(
      (e) => e,
    )) as InstanceType<typeof ServiceError>;

    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(500);
    errorSpy.mockRestore();
  });
});
