import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  identification_type: string;
  phone: string;
  email: string;
};

type MockSpies = {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateEq: ReturnType<typeof vi.fn>;
  selectEq: ReturnType<typeof vi.fn>;
};

function createMockSupabase(
  opts: {
    existing?: CustomerRow | null;
    insertResult?: { data: { id: string } | null; error: { message: string } | null };
    updateError?: { message: string } | null;
  },
): { client: unknown; spies: MockSpies } {
  const existing = opts.existing ?? null;
  const insertResult = opts.insertResult ?? { data: { id: "new-customer-id" }, error: null };
  const updateError = opts.updateError ?? null;

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(insertResult),
    }),
  });

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const selectEq = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: existing, error: existing ? null : { code: "PGRST116" } }),
    }),
  });

  const client = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: selectEq }),
      insert,
      update,
    }),
  };

  return { client, spies: { insert, update, updateEq, selectEq } };
}

const INPUT = {
  first_name: "Juan",
  last_name: "Pérez",
  identification_type: "CC",
  identification_number: "10101100100",
  phone: "+573001234567",
  email: "juan@example.com",
};

describe("findOrCreateCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing customer id without updating when data matches (same identification)", async () => {
    const { client, spies } = createMockSupabase({
      existing: {
        id: "existing-id",
        first_name: INPUT.first_name,
        last_name: INPUT.last_name,
        identification_type: INPUT.identification_type,
        phone: INPUT.phone,
        email: INPUT.email,
      },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    const id = await findOrCreateCustomer(INPUT);

    expect(id).toBe("existing-id");
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("returns existing id WITHOUT mutating when identification matches but contact data differs (issue #25)", async () => {
    const { client, spies } = createMockSupabase({
      existing: {
        id: "existing-id",
        first_name: "Juan",
        last_name: "P",
        identification_type: "CC",
        phone: "+573000000000",
        email: "old@example.com",
      },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    // Same CC, different name/email/phone — must NOT rewrite the existing record.
    // A CC collision would otherwise rewrite the apparent owner of every past
    // reservation tied to this customer (reservations only hold an FK).
    const id = await findOrCreateCustomer(INPUT);

    expect(id).toBe("existing-id");
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateEq).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("creates a new customer when identification does not exist (no email fallback)", async () => {
    const { client, spies } = createMockSupabase({
      existing: null,
      insertResult: { data: { id: "new-customer-id" }, error: null },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    const id = await findOrCreateCustomer(INPUT);

    expect(id).toBe("new-customer-id");
    expect(spies.insert).toHaveBeenCalledTimes(1);
    expect(spies.insert).toHaveBeenCalledWith({
      first_name: INPUT.first_name,
      last_name: INPUT.last_name,
      identification_type: INPUT.identification_type,
      identification_number: INPUT.identification_number,
      phone: INPUT.phone,
      email: INPUT.email,
      status: "active",
    });
    expect(spies.update).not.toHaveBeenCalled();
    // Never looks up by email (single query path: identification_number only)
    expect(spies.selectEq).toHaveBeenCalledTimes(1);
    expect(spies.selectEq).toHaveBeenCalledWith("identification_number", INPUT.identification_number);
  });

  it("regression: real-on-test CC collision returns test customer id untouched (incident 2026-05-12)", async () => {
    // Reproduces the incident: a real person (JOSE CHIACHIO) booked with CC 123456,
    // which collided with the test customer 0c91b776 (test90/test90). The old code
    // overwrote the test row with JOSE's data, retroactively rewriting the owner of
    // every past reservation tied to it. The fix must leave the matched row untouched.
    const testCustomer = {
      id: "0c91b776",
      first_name: "test90",
      last_name: "test90",
      identification_type: "CC",
      phone: "+570000000000",
      email: "test90@example.com",
    };
    const { client, spies } = createMockSupabase({ existing: testCustomer });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    const id = await findOrCreateCustomer({
      first_name: "JOSE",
      last_name: "CHIACHIO",
      identification_type: "CC",
      identification_number: "123456",
      phone: "+573009998877",
      email: "jose@example.com",
    });

    expect(id).toBe("0c91b776");
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("throws when insert fails", async () => {
    const { client } = createMockSupabase({
      existing: null,
      insertResult: { data: null, error: { message: "duplicate key" } },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    await expect(findOrCreateCustomer(INPUT)).rejects.toThrow(/Error al crear cliente/);
  });

  // SCEN-D (issue #138) — two concurrent requests for the SAME new customer race:
  // both pass the initial empty SELECT, both INSERT, one wins and the other hits
  // the customers_identification_number_key unique violation (23505). The loser
  // must recover the winner's id via re-SELECT (find-after-conflict), WITHOUT
  // throwing a 500 and WITHOUT a second write (respects #25: never mutate).
  it("SCEN-D: concurrent new-customer 23505 → recovers winner id via re-SELECT, no second write", async () => {
    // SELECT-by-identification: empty first (not found → INSERT path), then the
    // winner on the post-conflict re-SELECT. Same `single` spy, chained.
    const selectSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } })
      .mockResolvedValueOnce({ data: { id: "winner-id" }, error: null });
    const selectEq = vi
      .fn()
      .mockReturnValue({ limit: vi.fn().mockReturnValue({ single: selectSingle }) });

    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "customers_identification_number_key"',
      },
    });
    const insert = vi
      .fn()
      .mockReturnValue({ select: vi.fn().mockReturnValue({ single: insertSingle }) });

    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: selectEq }),
        insert,
      }),
    };

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    const id = await findOrCreateCustomer(INPUT);

    expect(id).toBe("winner-id");
    // INSERT attempted exactly once — not retried.
    expect(insert).toHaveBeenCalledTimes(1);
    // SELECT-by-identification ran twice: initial miss + post-conflict recovery.
    expect(selectEq).toHaveBeenCalledTimes(2);
    expect(selectEq).toHaveBeenCalledWith(
      "identification_number",
      INPUT.identification_number,
    );
  });

  // SCEN-E sibling for customers — a 23505 on a DIFFERENT constraint is a real
  // failure, not a concurrent-new-customer race, so it still throws.
  it("SCEN-D guard: 23505 on a different constraint still throws", async () => {
    const { client } = createMockSupabase({
      existing: null,
      insertResult: {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "customers_pkey"',
        } as { message: string },
      },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    await expect(findOrCreateCustomer(INPUT)).rejects.toThrow(/Error al crear cliente/);
  });
});

type ReferralRow = { id: string };

function createMockReferralSupabase(
  result: { data: ReferralRow | null; error: { code: string } | null },
): {
  client: unknown;
  spies: { from: ReturnType<typeof vi.fn>; codeEq: ReturnType<typeof vi.fn>; statusEq: ReturnType<typeof vi.fn> };
} {
  const single = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ single });
  const statusEq = vi.fn().mockReturnValue({ limit });
  const codeEq = vi.fn().mockReturnValue({ eq: statusEq });
  const select = vi.fn().mockReturnValue({ eq: codeEq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, spies: { from, codeEq, statusEq } };
}

describe("resolveReferral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns referral id for capitalized active code ('Diana')", async () => {
    const { client, spies } = createMockReferralSupabase({
      data: { id: "diana-id" },
      error: null,
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { resolveReferral } = await import("@/lib/api/resolve-references");
    const id = await resolveReferral("Diana");

    expect(id).toBe("diana-id");
    expect(spies.codeEq).toHaveBeenCalledWith("code", "diana");
    expect(spies.statusEq).toHaveBeenCalledWith("status", "active");
  });

  it("returns referral id for already-lowercase code ('diana')", async () => {
    const { client, spies } = createMockReferralSupabase({
      data: { id: "diana-id" },
      error: null,
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { resolveReferral } = await import("@/lib/api/resolve-references");
    const id = await resolveReferral("diana");

    expect(id).toBe("diana-id");
    expect(spies.codeEq).toHaveBeenCalledWith("code", "diana");
  });

  it("trims whitespace and lowercases (' DIANA ')", async () => {
    const { client, spies } = createMockReferralSupabase({
      data: { id: "diana-id" },
      error: null,
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { resolveReferral } = await import("@/lib/api/resolve-references");
    const id = await resolveReferral(" DIANA ");

    expect(id).toBe("diana-id");
    expect(spies.codeEq).toHaveBeenCalledWith("code", "diana");
  });

  it("returns null for inactive referral ('Valeria' filtered by status)", async () => {
    const { client, spies } = createMockReferralSupabase({
      data: null,
      error: { code: "PGRST116" },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { resolveReferral } = await import("@/lib/api/resolve-references");
    const id = await resolveReferral("Valeria");

    expect(id).toBeNull();
    expect(spies.codeEq).toHaveBeenCalledWith("code", "valeria");
    expect(spies.statusEq).toHaveBeenCalledWith("status", "active");
  });

  it("returns null for nonexistent code", async () => {
    const { client } = createMockReferralSupabase({
      data: null,
      error: { code: "PGRST116" },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { resolveReferral } = await import("@/lib/api/resolve-references");
    const id = await resolveReferral("nonexistent");

    expect(id).toBeNull();
  });
});
