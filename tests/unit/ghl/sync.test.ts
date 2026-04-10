import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/ghl/client", () => ({
  upsertContact: vi.fn().mockResolvedValue({ contact: { id: "ghl-contact-123" } }),
  createOpportunity: vi.fn().mockResolvedValue({ opportunity: { id: "ghl-opp-456" } }),
  updateOpportunity: vi.fn().mockResolvedValue({}),
  searchOpportunities: vi.fn().mockResolvedValue({ opportunities: [] }),
}));

vi.mock("@/lib/ghl/config", () => ({
  getGhlConfig: vi.fn(),
  getStageId: vi.fn().mockReturnValue("stage-pendiente-id"),
  getOpportunityStatus: vi.fn().mockReturnValue("open"),
}));

const mockReservation = {
  id: "res-123",
  franchise: "alquilame",
  status: "pendiente",
  reservation_code: "AV78XC3JDA",
  category_code: "C",
  total_price: 400000,
  pickup_date: "2026-04-15",
  pickup_hour: "09:00",
  return_date: "2026-04-20",
  return_hour: "09:00",
  ghl_contact_id: null,
  ghl_opportunity_id: null,
  customers: { first_name: "Juan", last_name: "Perez", email: "juan@example.com", phone: "+573001234567" },
  pickup_location: { name: "Bogotá Aeropuerto", cities: { name: "Bogotá" } },
  return_location: { name: "Bogotá Aeropuerto", cities: { name: "Bogotá" } },
};

function createMockSupabase(reservation = mockReservation) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: reservation, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  };
}

describe("syncReservationToGhl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips sync if franchise has no GHL config", async () => {
    const { getGhlConfig } = await import("@/lib/ghl/config");
    vi.mocked(getGhlConfig).mockReturnValue(null);

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(createMockSupabase() as unknown as ReturnType<typeof createAdminClient>);

    const { syncReservationToGhl } = await import("@/lib/ghl/sync");
    const { upsertContact } = await import("@/lib/ghl/client");

    await syncReservationToGhl("res-123");
    expect(upsertContact).not.toHaveBeenCalled();
  });

  it("upserts contact and creates opportunity when configured", async () => {
    const { getGhlConfig } = await import("@/lib/ghl/config");
    vi.mocked(getGhlConfig).mockReturnValue({
      api_key: "test-key",
      location_id: "loc-123",
      pipeline_id: "pipe-456",
      stages: { pendiente: "s1", reservado: "s2", pendiente_modificar: "s3", utilizado: "s4", sin_disponibilidad: "s5", mensualidad: "s6" },
    });

    const { createAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createAdminClient).mockReturnValue(createMockSupabase() as unknown as ReturnType<typeof createAdminClient>);

    const { syncReservationToGhl } = await import("@/lib/ghl/sync");
    const { upsertContact, createOpportunity } = await import("@/lib/ghl/client");

    await syncReservationToGhl("res-123");
    expect(upsertContact).toHaveBeenCalled();
    expect(createOpportunity).toHaveBeenCalled();
  });
});
