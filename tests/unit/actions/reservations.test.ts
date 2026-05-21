import { describe, it, expect, vi, beforeEach } from "vitest";

// updateReservation/createReservation are server-only (Supabase + revalidatePath).
// These unit tests pin the payload contract:
//   - referral_id and referral_raw are stripped on update (issue #48 anti-fraud).
//   - status is stripped on update (issue #10).
//   - referral fields are still written on create (legitimate attribution path).

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Outbound side-effects are non-blocking — stub so tests don't hit network or
// fail when fetch-time data lookups error out.
vi.mock("@/lib/email/notifications", () => ({
  sendReservationNotifications: vi.fn().mockResolvedValue(undefined),
  sendReservationRequestEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wati/notifications", () => ({
  sendStatusWhatsApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ghl/sync", () => ({
  syncReservationToGhl: vi.fn().mockResolvedValue(undefined),
}));

type DbError = { code?: string; message: string } | null;

/**
 * Chainable Supabase stub for update path:
 *   from(table).update(payload).eq(col, val)
 * The `update` spy captures the payload so tests can assert exactly which
 * columns will be written.
 */
function makeUpdateClient(eqResult: { error: DbError }) {
  const eq = vi.fn().mockResolvedValue(eqResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from } as unknown, from, update, eq };
}

/**
 * Chainable Supabase stub for create path:
 *   from(table).insert(payload)
 * After insert, the action fires a select chain to fetch the inserted id —
 * stub that too so the post-insert path doesn't throw.
 */
function makeInsertClient(insertResult: { error: DbError }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  // select(...).eq(...).eq(...).eq(...).order(...).limit(...).single()
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const eq3 = vi.fn().mockReturnValue({ order });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockImplementation(() => ({ insert, select }));
  return { client: { from } as unknown, from, insert };
}

// Valid v4 UUIDs (version nibble = 4, variant nibble in {8,9,a,b}).
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const REFERRAL_ID = "44444444-4444-4444-8444-444444444444";

function validReservationForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    customer_id: CUSTOMER_ID,
    rental_company_id: COMPANY_ID,
    pickup_location_id: LOCATION_ID,
    return_location_id: LOCATION_ID,
    franchise: "alquilatucarro",
    booking_type: "standard",
    category_code: "ECON",
    pickup_date: "2026-06-01",
    pickup_hour: "10:00",
    return_date: "2026-06-05",
    return_hour: "10:00",
    selected_days: "4",
    total_price: "1000",
    total_price_to_pay: "1000",
    total_price_localiza: "0",
    tax_fee: "0",
    iva_fee: "0",
    coverage_days: "0",
    coverage_price: "0",
    return_fee: "0",
    extra_hours: "0",
    extra_hours_price: "0",
    total_insurance: "false",
    extra_driver: "false",
    baby_seat: "false",
    wash: "false",
    notification_required: "false",
    status: "reservado",
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) fd.set(k, v);
  return fd;
}

describe("updateReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips referral_id and referral_raw so an operator cannot reassign attribution (issue #48)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeUpdateClient({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateReservation } = await import("@/lib/actions/reservations");
    const result = await updateReservation(
      "res-1",
      validReservationForm({
        referral_id: REFERRAL_ID,
        referral_raw: "operador-fraudulento",
      }),
    );

    expect(result).toEqual({});
    expect(sb.from).toHaveBeenCalledWith("reservations");
    const payload = sb.update.mock.calls[0][0];
    expect("referral_id" in payload).toBe(false);
    expect("referral_raw" in payload).toBe(false);
    // Same precedent as issue #10 — status is stripped on update too.
    expect("status" in payload).toBe(false);
    expect(sb.eq).toHaveBeenCalledWith("id", "res-1");
  });
});

describe("createReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves referral_id and referral_raw on create (legitimate attribution path)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeInsertClient({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { createReservation } = await import("@/lib/actions/reservations");
    const result = await createReservation(
      validReservationForm({
        referral_id: REFERRAL_ID,
        referral_raw: "rentacar-web-attribution",
      }),
    );

    expect(result).toEqual({});
    const payload = sb.insert.mock.calls[0][0];
    expect(payload.referral_id).toBe(REFERRAL_ID);
    expect(payload.referral_raw).toBe("rentacar-web-attribution");
  });
});
