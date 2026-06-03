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
// `after` keeps the function alive for post-response dispatch; invoke the callback
// synchronously so the test can observe the fan-out it schedules.
vi.mock("next/server", () => ({
  after: vi.fn((cb: () => unknown) => cb()),
}));

type DbError = { code?: string; message: string } | null;

/**
 * Chainable Supabase stub for update path:
 *   from(table).update(payload).eq(col, val)
 * The `update` spy captures the payload so tests can assert exactly which
 * columns will be written.
 */
/**
 * Chainable Supabase stub for the update path. updateReservation now reads the
 * stored customer_id BEFORE updating (issue #26): a reassignment re-snapshots
 * via the resnapshot RPC, a normal edit does not. The stub dispatches:
 *   from("reservations").select("customer_id").eq("id", id).single() → current
 *   from("reservations").update(payload).eq("id", id)                → result
 *   rpc("resnapshot_reservation", { p_id })                          → result
 */
function makeUpdateClient(
  eqResult: { error: DbError },
  opts: {
    currentCustomerId?: string;
    fetchError?: DbError;
    rpcError?: DbError;
  } = {},
) {
  const {
    currentCustomerId = CUSTOMER_ID,
    fetchError = null,
    rpcError = null,
  } = opts;

  // read: select("customer_id").eq("id", id).single()
  const single = vi.fn().mockResolvedValue({
    data: fetchError ? null : { customer_id: currentCustomerId },
    error: fetchError,
  });
  const selectEq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq: selectEq });

  // write: update(payload).eq("id", id)
  const updateEq = vi.fn().mockResolvedValue(eqResult);
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const from = vi.fn().mockReturnValue({ select, update });
  const rpc = vi.fn().mockResolvedValue({ error: rpcError });
  return { client: { from, rpc } as unknown, from, update, eq: updateEq, rpc, select };
}

// Default stored customer row served for from("customers") reads. Distinct
// values per field so a snapshot assertion proves the source is the customer
// row, not the form payload.
const CUSTOMER_ROW = {
  first_name: "Stored",
  last_name: "Owner",
  email: "stored@example.com",
  phone: "+573001112233",
  identification_type: "CC",
  identification_number: "123456",
};

/**
 * Chainable Supabase stub for create path. createReservation now reads the
 * customers row (issue #26 snapshot) BEFORE inserting the reservation, so the
 * stub dispatches by table:
 *   from("customers").select(cols).eq("id", id).single()  → customer row
 *   from("reservations").insert(payload)                  → insert result
 *   from("reservations").select(...).eq×3.order.limit.single() → inserted id
 */
function makeInsertClient(
  insertResult: { error: DbError },
  customerRow: typeof CUSTOMER_ROW | null = CUSTOMER_ROW,
) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  // select(...).eq(...).eq(...).eq(...).order(...).limit(...).single()
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const eq3 = vi.fn().mockReturnValue({ order });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const reservationSelect = vi.fn().mockReturnValue({ eq: eq1 });

  // customers read: select(cols).eq("id", id).single()
  const customerSingle = vi
    .fn()
    .mockResolvedValue({ data: customerRow, error: customerRow ? null : { message: "not found" } });
  const customerEq = vi.fn().mockReturnValue({ single: customerSingle });
  const customerSelect = vi.fn().mockReturnValue({ eq: customerEq });

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === "customers") return { select: customerSelect };
    return { insert, select: reservationSelect };
  });
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

  // SCEN-004: changing customer_id reassigns the reservation; the snapshot must
  // follow the NEW customer. The plain UPDATE leaves the snapshot columns frozen
  // on the old customer, so the action calls the resnapshot RPC to refresh them.
  it("re-snapshots via RPC when customer_id changes (reassign)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    // Stored owner differs from the form's customer_id → reassignment.
    const OTHER_CUSTOMER = "55555555-5555-4555-8555-555555555555";
    const sb = makeUpdateClient(
      { error: null },
      { currentCustomerId: OTHER_CUSTOMER },
    );
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateReservation } = await import("@/lib/actions/reservations");
    const result = await updateReservation("res-1", validReservationForm());

    expect(result).toEqual({});
    // The UPDATE payload must NOT carry snapshot columns — the RPC owns them.
    const payload = sb.update.mock.calls[0][0];
    expect("customer_name_at_booking" in payload).toBe(false);
    expect(sb.rpc).toHaveBeenCalledWith("resnapshot_reservation", {
      p_id: "res-1",
    });
  });

  // SCEN-005: editing a reservation WITHOUT changing customer_id must not touch
  // the snapshot — the RPC is never called, so a concurrently-mutated customer
  // row cannot re-corrupt the frozen identity.
  it("does NOT re-snapshot when customer_id is unchanged (normal edit)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    // Stored owner equals the form's customer_id → no reassignment.
    const sb = makeUpdateClient(
      { error: null },
      { currentCustomerId: CUSTOMER_ID },
    );
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateReservation } = await import("@/lib/actions/reservations");
    const result = await updateReservation("res-1", validReservationForm());

    expect(result).toEqual({});
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  // The RPC failing on reassign must surface as { error } (action contract).
  it("returns { error } when the reassign RPC fails", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeUpdateClient(
      { error: null },
      {
        currentCustomerId: "55555555-5555-4555-8555-555555555555",
        rpcError: { message: "resnapshot failed" },
      },
    );
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateReservation } = await import("@/lib/actions/reservations");
    const result = await updateReservation("res-1", validReservationForm());

    expect(result).toEqual({ error: "resnapshot failed" });
  });

  // If the pre-read of the stored customer_id fails (e.g. the reservation was
  // hard-deleted between page load and save), the action returns a friendly
  // Spanish message — not the raw PostgREST error — and never proceeds to write.
  it("returns a friendly { error } when the reservation pre-read fails", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeUpdateClient(
      { error: null },
      { fetchError: { message: "PGRST116: no rows returned" } },
    );
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateReservation } = await import("@/lib/actions/reservations");
    const result = await updateReservation("res-1", validReservationForm());

    expect(result).toEqual({
      error:
        "No se pudo cargar la reserva. Recarga la página e intenta de nuevo.",
    });
    // Must not attempt the UPDATE after a failed pre-read.
    expect(sb.update).not.toHaveBeenCalled();
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

  // SCEN-003: the dashboard create path freezes the customer snapshot onto the
  // reservation (issue #26), sourced from the customers row that customer_id
  // points to — not from the form fields.
  it("writes the 5 snapshot fields sourced from the customer row on create", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeInsertClient({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { createReservation } = await import("@/lib/actions/reservations");
    const result = await createReservation(validReservationForm());

    expect(result).toEqual({});
    expect(sb.from).toHaveBeenCalledWith("customers");

    const payload = sb.insert.mock.calls[0][0];
    expect(payload.customer_id).toBe(CUSTOMER_ID);
    expect(payload.customer_name_at_booking).toBe("Stored Owner");
    expect(payload.customer_email_at_booking).toBe("stored@example.com");
    expect(payload.customer_phone_at_booking).toBe("+573001112233");
    expect(payload.customer_identification_type_at_booking).toBe("CC");
    expect(payload.customer_identification_number_at_booking).toBe("123456");
  });

  // SCEN-010: a customer_id that no longer resolves (TOCTOU hard-delete, stale
  // form) must return { error } — never throw — so the form shows a toast. The
  // snapshot read throws on a missing row; createReservation must catch it and
  // preserve the action contract (conventions.md). Insert must never run.
  it("returns { error } (does not throw) when the customer row is missing", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeInsertClient({ error: null }, null); // customers read → no row
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { createReservation } = await import("@/lib/actions/reservations");
    const result = await createReservation(validReservationForm());

    expect(result.error).toBeTruthy();
    expect(sb.insert).not.toHaveBeenCalled();
  });
});

/**
 * Chainable Supabase stub for updateReservationStatus:
 *   select("status").eq(id).single()    → current status
 *   select("franchise").eq(id).single() → franchise
 *   update({status}).eq(id)             → write
 */
function makeStatusUpdateClient() {
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: { status: "pendiente" }, error: null })
    .mockResolvedValueOnce({ data: { franchise: "alquilatucarro" }, error: null });
  const selectEq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq: selectEq });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn().mockReturnValue({ select, update });
  return { client: { from } as unknown, from };
}

describe("updateReservationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // SCEN-005: dispatch runs via after() so the spaced WhatsApp sends aren't truncated.
  it("dispatches notifications via after() on a reservado transition (issue #60)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeStatusUpdateClient();
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { after } = await import("next/server");
    const { sendStatusWhatsApp } = await import("@/lib/wati/notifications");
    const { updateReservationStatus } = await import("@/lib/actions/reservations");

    const result = await updateReservationStatus("res-9", "reservado");

    expect(result).toEqual({});
    expect(after).toHaveBeenCalledOnce();
    expect(sendStatusWhatsApp).toHaveBeenCalledWith("res-9", "reservado");
  });

  it("rejects an invalid transition without dispatching", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    // current status === target → not in VALID_TRANSITIONS (filtered out)
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: { status: "reservado" }, error: null });
    const selectEq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq: selectEq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createClient).mockResolvedValue(
      { from } as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const { after } = await import("next/server");
    const { sendStatusWhatsApp } = await import("@/lib/wati/notifications");
    const { updateReservationStatus } = await import("@/lib/actions/reservations");

    const result = await updateReservationStatus("res-9", "reservado");

    expect(result.error).toContain("Transición no válida");
    expect(after).not.toHaveBeenCalled();
    expect(sendStatusWhatsApp).not.toHaveBeenCalled();
  });
});
