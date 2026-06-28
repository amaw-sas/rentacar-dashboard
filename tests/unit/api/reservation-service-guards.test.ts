import { describe, it, expect, vi, beforeEach } from "vitest";

// Anti-abuse guards on the SHARED service `createReservation` (synthetic-wave
// fix, jun 2026). Placing the guards in the service — not the route handler —
// means BOTH funnels are covered: the public POST /api/reservations route AND
// the in-process MCP/chat path. Scenarios G1–G7.

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/api/resolve-references", () => ({
  resolveLocationByCode: vi.fn(),
  findOrCreateCustomer: vi.fn(),
  resolveReferral: vi.fn(),
}));
vi.mock("@/lib/queries/customers", () => ({ snapshotFromCustomer: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/normalize-identification-type", () => ({
  normalizeIdentificationType: vi.fn((t: string) => t),
}));
vi.mock("@/lib/email/notifications", () => ({
  sendReservationNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wati/notifications", () => ({
  sendStatusWhatsApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ghl/sync", () => ({ syncReservationToGhl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/reservation/mileage-parser", () => ({ parseMonthlyMileage: vi.fn(() => null) }));
vi.mock("next/server", () => ({ after: vi.fn() }));

interface GuardOpts {
  docAllowed?: boolean;
  ipAllowed?: boolean;
  duplicate?: { id: string; reservation_code: string | null; status: string } | null;
  rpcError?: boolean;
}

function makeGuardedAdminClient(opts: GuardOpts = {}) {
  const { docAllowed = true, ipAllowed = true, duplicate = null, rpcError = false } = opts;

  const rpc = vi.fn(async (_name: string, params: { p_key: string }) => {
    if (rpcError) return { data: null, error: { message: "rpc down" } };
    const allowed = params.p_key.startsWith("resv:ip:") ? ipAllowed : docAllowed;
    return { data: [{ allowed, remaining: 0, reset_at: null }], error: null };
  });

  // dedup chain: select().eq()...gte().limit() → {data,error}
  const limit = vi.fn().mockResolvedValue({ data: duplicate ? [duplicate] : [], error: null });
  const dedupChain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gte"]) dedupChain[m] = vi.fn(() => dedupChain);
  dedupChain.limit = limit;

  // insert chain: insert().select("id").single() → {data,error}
  const single = vi.fn().mockResolvedValue({ data: { id: "res-new" }, error: null });
  const insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });

  const from = vi.fn(() => ({ select: dedupChain.select as () => unknown, insert }));
  return { client: { rpc, from } as unknown, rpc, insert };
}

const MONTHLY_INPUT = {
  fullname: "Carlos Rincon",
  identification_type: "CC",
  identification: "1018456723",
  phone: "3104567890",
  email: "c@example.com",
  category: "C",
  pickup_location: "BOG01",
  return_location: "BOG01",
  pickup_date: "2026-07-10",
  pickup_hour: "09:00",
  return_date: "2026-08-10",
  return_hour: "09:00",
  selected_days: 30, // monthly → never reaches the Localiza proxy
  total_price: 1000,
  total_price_to_pay: 1000,
  franchise: "alquilatucarro",
};

async function wireResolvers() {
  const { resolveLocationByCode, findOrCreateCustomer, resolveReferral } =
    await import("@/lib/api/resolve-references");
  vi.mocked(resolveLocationByCode).mockResolvedValue({
    id: "loc-1", rental_company_id: "rc-1",
  } as never);
  vi.mocked(findOrCreateCustomer).mockResolvedValue("cust-1");
  vi.mocked(resolveReferral).mockResolvedValue(null as never);
}

async function loadServiceWith(admin: { client: unknown }) {
  vi.resetModules();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  vi.mocked(createAdminClient).mockReturnValue(admin.client as never);
  await wireResolvers();
  const { createReservation } = await import("@/lib/api/reservation-service");
  const { ServiceError } = await import("@/lib/api/service-error");
  return { createReservation, ServiceError };
}

describe("createReservation — anti-abuse guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESERVATION_RATE_LIMIT_IP_PER_HOUR;
    delete process.env.RESERVATION_RATE_LIMIT_DOC_PER_HOUR;
    delete process.env.RESERVATION_DEDUP_WINDOW_SECONDS;
  });

  it("G4: under limits, unique booking → succeeds and inserts", async () => {
    const admin = makeGuardedAdminClient();
    const { createReservation } = await loadServiceWith(admin);
    const res = await createReservation({ ...MONTHLY_INPUT, client_ip: "1.1.1.1" });
    expect(res.reservationStatus).toBe("mensualidad");
    expect(admin.insert).toHaveBeenCalledTimes(1);
    // both per-doc AND per-ip checked when an IP is supplied (public funnel)
    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("G4b: MCP funnel (no client_ip) only runs the per-doc limit", async () => {
    const admin = makeGuardedAdminClient();
    const { createReservation } = await loadServiceWith(admin);
    await createReservation({ ...MONTHLY_INPUT });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc.mock.calls[0][1].p_key).toBe("resv:doc:1018456723");
  });

  it("G2: per-identity (doc) limit exceeded → ServiceError(429), no insert", async () => {
    const admin = makeGuardedAdminClient({ docAllowed: false });
    const { createReservation, ServiceError } = await loadServiceWith(admin);
    const err = await createReservation({ ...MONTHLY_INPUT }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(429);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("G3: per-IP limit exceeded → ServiceError(429), no insert", async () => {
    const admin = makeGuardedAdminClient({ ipAllowed: false });
    const { createReservation, ServiceError } = await loadServiceWith(admin);
    const err = await createReservation({ ...MONTHLY_INPUT, client_ip: "9.9.9.9" }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(429);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("G1: identical re-submit within window → ServiceError(409) with dup code, no insert", async () => {
    const admin = makeGuardedAdminClient({
      duplicate: { id: "dup-1", reservation_code: "AVDUP", status: "reservado" },
    });
    const { createReservation, ServiceError } = await loadServiceWith(admin);
    const err = await createReservation({ ...MONTHLY_INPUT }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(409);
    expect(err.payload.reserveCode).toBe("AVDUP");
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it("G6: rate-limit infra error → fail-open → succeeds and inserts", async () => {
    const admin = makeGuardedAdminClient({ rpcError: true });
    const { createReservation } = await loadServiceWith(admin);
    const res = await createReservation({ ...MONTHLY_INPUT });
    expect(res.reservationStatus).toBe("mensualidad");
    expect(admin.insert).toHaveBeenCalledTimes(1);
  });
});
