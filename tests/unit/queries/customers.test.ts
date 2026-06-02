import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// snapshotFromCustomer reads the customers row by id and freezes a denormalized
// snapshot of the booker's identity at INSERT time (issue #26). The snapshot is
// always sourced from the STORED customer row (not raw request input) so that a
// #25 lenient CC-collision — which returns an existing customer whose data may
// differ from the submitted body — produces a faithful snapshot of who the FK
// actually points to.

type CustomerRow = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  identification_type: string;
  identification_number: string;
};

/**
 * Chainable Supabase stub:
 *   from("customers").select(cols).eq("id", id).single()
 * Captures select/eq args so tests can assert the exact read shape.
 */
function makeCustomerClient(result: {
  data: CustomerRow | null;
  error: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, single };
}

describe("snapshotFromCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a customer row to the 5 snapshot fields (name = 'Jose Chiachio')", async () => {
    const sb = makeCustomerClient({
      data: {
        first_name: "Jose",
        last_name: "Chiachio",
        email: "jose@example.com",
        phone: "+573009998877",
        identification_type: "CC",
        identification_number: "123456",
      },
      error: null,
    });

    const { snapshotFromCustomer } = await import("@/lib/queries/customers");
    const snapshot = await snapshotFromCustomer(sb.client, "cust-1");

    expect(snapshot).toEqual({
      customer_name_at_booking: "Jose Chiachio",
      customer_email_at_booking: "jose@example.com",
      customer_phone_at_booking: "+573009998877",
      customer_identification_type_at_booking: "CC",
      customer_identification_number_at_booking: "123456",
    });
    expect(sb.from).toHaveBeenCalledWith("customers");
    expect(sb.select).toHaveBeenCalledWith(
      "first_name,last_name,email,phone,identification_type,identification_number",
    );
    expect(sb.eq).toHaveBeenCalledWith("id", "cust-1");
  });

  it("freezes an ETL placeholder last_name='.' as display-consistent name 'Jose .'", async () => {
    const sb = makeCustomerClient({
      data: {
        first_name: "Jose",
        last_name: ".",
        email: "jose@example.com",
        phone: "+573009998877",
        identification_type: "CC",
        identification_number: "123456",
      },
      error: null,
    });

    const { snapshotFromCustomer } = await import("@/lib/queries/customers");
    const snapshot = await snapshotFromCustomer(sb.client, "cust-2");

    expect(snapshot.customer_name_at_booking).toBe("Jose .");
  });

  it("throws when the customer row is missing (Supabase error)", async () => {
    const sb = makeCustomerClient({
      data: null,
      error: { message: "PGRST116: no rows" },
    });

    const { snapshotFromCustomer } = await import("@/lib/queries/customers");
    await expect(snapshotFromCustomer(sb.client, "missing")).rejects.toThrow();
  });
});
