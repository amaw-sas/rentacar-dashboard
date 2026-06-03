import { describe, it, expect, vi, beforeEach } from "vitest";

// updateCustomerContact is server-only (Supabase + revalidatePath).
// Unit tests validate the contract: partial update, no notes/status leak,
// friendly unique-violation message, zod gate before any DB call.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type EqResult = { error: { code?: string; message: string } | null };

/**
 * Builds a chainable Supabase stub: from(table).update(payload).eq(col, val)
 * The update spy captures the payload so tests can assert exactly which
 * columns are written. `rpc` stubs the resnapshot RPC (issue #26) so the
 * inline-edit re-snapshot path (SCEN-009) can be asserted.
 */
function makeSupabase(eqResult: EqResult, rpcResult: EqResult = { error: null }) {
  const eq = vi.fn().mockResolvedValue(eqResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { from, rpc } as unknown, from, update, eq, rpc };
}

const validContact = {
  first_name: "Juan",
  last_name: "Perez",
  identification_type: "CC",
  identification_number: "1234567890",
  phone: "+57 300 1234567",
  email: "juan@example.com",
};

function formDataOf(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

describe("updateCustomerContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only the 6 contact columns — never notes or status", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const { revalidatePath } = await import("next/cache");
    const sb = makeSupabase({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    // FormData intentionally also carries notes/status — must be stripped.
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf({ ...validContact, notes: "cliente VIP", status: "inactive" }),
    );

    expect(result).toEqual({});
    expect(sb.from).toHaveBeenCalledWith("customers");
    const payload = sb.update.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual([
      "email",
      "first_name",
      "identification_number",
      "identification_type",
      "last_name",
      "phone",
    ]);
    expect("notes" in payload).toBe(false);
    expect("status" in payload).toBe(false);
    expect(sb.eq).toHaveBeenCalledWith("id", "cust-1");
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
    expect(revalidatePath).toHaveBeenCalledWith("/reservations");
  });

  it("rejects an empty customer id without touching the database", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact("", formDataOf(validContact));

    expect(result).toEqual({ error: "Cliente no seleccionado" });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before touching the database", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf({ ...validContact, email: "noesunemail" }),
    );

    expect(result.error).toBeTruthy();
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("maps a unique-violation on identification_number to a friendly message", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "customers_identification_number_key"',
      },
    });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf(validContact),
    );

    expect(result).toEqual({
      error: "Ya existe un cliente con ese número de identificación",
    });
  });

  it("returns the raw Supabase message for other DB errors", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({
      error: { code: "42501", message: "permission denied for table customers" },
    });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf(validContact),
    );

    expect(result).toEqual({
      error: "permission denied for table customers",
    });
  });

  // SCEN-009: an inline contact edit from a reservation form re-snapshots ONLY
  // that reservation. After the customers UPDATE, the action calls the RPC with
  // the reservation id so R reflects the correction while X's other reservations
  // stay frozen. The trigger accepts the matching write (RPC reads the same row).
  it("re-snapshots only the given reservation after an inline contact edit (reservationId passed)", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf(validContact),
      "res-1",
    );

    expect(result).toEqual({});
    expect(sb.from).toHaveBeenCalledWith("customers");
    expect(sb.rpc).toHaveBeenCalledWith("resnapshot_reservation", {
      p_id: "res-1",
    });
  });

  // SCEN-009 (companion): without a reservationId (e.g. editing a customer from
  // the customers page, not from a reservation form), no re-snapshot fires — the
  // global edit must NOT rewrite any reservation's frozen snapshot.
  it("does NOT re-snapshot when no reservationId is given", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase({ error: null });
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf(validContact),
    );

    expect(result).toEqual({});
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  // The RPC failing must surface as { error } (action contract) — not a silent
  // success that leaves R's display stale relative to the just-saved contact.
  it("returns { error } when the re-snapshot RPC fails", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    const sb = makeSupabase(
      { error: null },
      { error: { message: "resnapshot failed" } },
    );
    vi.mocked(createClient).mockResolvedValue(
      sb.client as Awaited<ReturnType<typeof createClient>>,
    );

    const { updateCustomerContact } = await import("@/lib/actions/customers");
    const result = await updateCustomerContact(
      "cust-1",
      formDataOf(validContact),
      "res-1",
    );

    expect(result).toEqual({ error: "resnapshot failed" });
  });
});
