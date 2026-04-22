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

  it("updates contact fields when identification matches but data differs (policy A)", async () => {
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
    const id = await findOrCreateCustomer(INPUT);

    expect(id).toBe("existing-id");
    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith({
      first_name: INPUT.first_name,
      last_name: INPUT.last_name,
      identification_type: INPUT.identification_type,
      phone: INPUT.phone,
      email: INPUT.email,
    });
    expect(spies.updateEq).toHaveBeenCalledWith("id", "existing-id");
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

  it("throws when update fails", async () => {
    const { client } = createMockSupabase({
      existing: {
        id: "existing-id",
        first_name: "Otro",
        last_name: "Nombre",
        identification_type: INPUT.identification_type,
        phone: INPUT.phone,
        email: INPUT.email,
      },
      updateError: { message: "constraint violation" },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);

    const { findOrCreateCustomer } = await import("@/lib/api/resolve-references");
    await expect(findOrCreateCustomer(INPUT)).rejects.toThrow(/Error al actualizar cliente/);
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
});
