import { describe, it, expect, vi, beforeEach } from "vitest";

// createLocation / updateLocation are server-only (Supabase + revalidatePath).
// These tests validate the issue #97 round-trip contract: schedule arrives as a
// JSON string, is parsed + validated, display is derived server-side
// (authoritative, non-bypassable), and the latent bug (schedule wiped to {}) is
// fixed because schedule is now persisted from the request.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type DbResult = { error: { code?: string; message: string } | null };

/** Chainable Supabase stub for both insert and update(...).eq(...) paths. */
function makeSupabase(result: DbResult = { error: null }) {
  const insert = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockResolvedValue(result);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ insert, update });
  return { client: { from } as unknown, from, insert, update, eq };
}

const RC_ID = "11111111-1111-4111-8111-111111111111";
const CITY_ID = "22222222-2222-4222-8222-222222222222";

const validBase: Record<string, string> = {
  rental_company_id: RC_ID,
  code: "ATEST",
  name: "Sucursal Test",
  pickup_address: "Calle 1 #2-3",
  pickup_map: "https://maps.example/x",
  city_id: CITY_ID,
};

function formDataOf(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

async function withSupabase(result: DbResult = { error: null }) {
  const { createClient } = await import("@/lib/supabase/server");
  const sb = makeSupabase(result);
  vi.mocked(createClient).mockResolvedValue(
    sb.client as Awaited<ReturnType<typeof createClient>>,
  );
  return sb;
}

describe("createLocation — schedule round-trip + display derivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SCEN-010: persists the structured schedule with a derived display", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const schedule = {
      mon: ["08:00-18:00"], tue: ["08:00-18:00"], wed: ["08:00-18:00"],
      thu: ["08:00-18:00"], fri: ["08:00-18:00"],
    };
    const result = await createLocation(
      formDataOf({ ...validBase, schedule: JSON.stringify(schedule) }),
    );

    expect(result).toEqual({});
    const payload = sb.insert.mock.calls[0][0];
    expect(payload.schedule.mon).toEqual(["08:00-18:00"]);
    expect(payload.schedule.display).toBe("Lun-Vie 08:00-18:00 | Sáb-Dom y fest Cerrado");
  });

  it("SCEN-011: ignores an injected display, persisting the derived one", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const schedule = { mon: ["08:00-18:00"], display: "FALSO" };
    await createLocation(
      formDataOf({ ...validBase, schedule: JSON.stringify(schedule) }),
    );

    const payload = sb.insert.mock.calls[0][0];
    expect(payload.schedule.display).not.toBe("FALSO");
    expect(payload.schedule.display).toContain("Lun 08:00-18:00");
  });

  it("SCEN-004b: rejects an inverted range without persisting", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const result = await createLocation(
      formDataOf({ ...validBase, schedule: JSON.stringify({ mon: ["18:00-08:00"] }) }),
    );

    expect(result.error).toBeTruthy();
    expect(sb.insert).not.toHaveBeenCalled();
  });

  it("rejects malformed schedule JSON with a clear message", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const result = await createLocation(
      formDataOf({ ...validBase, schedule: "{not json" }),
    );

    expect(result.error).toBe("schedule: JSON inválido");
    expect(sb.insert).not.toHaveBeenCalled();
  });

  it("rejects a multi-range day (single-range contract, fail-loud)", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const result = await createLocation(
      formDataOf({
        ...validBase,
        schedule: JSON.stringify({ mon: ["08:00-12:00", "14:00-18:00"] }),
      }),
    );

    expect(result.error).toContain("un rango por día");
    expect(sb.insert).not.toHaveBeenCalled();
  });

  it("rejects a misspelled day key (.strict fail-loud)", async () => {
    const sb = await withSupabase();
    const { createLocation } = await import("@/lib/actions/locations");

    const result = await createLocation(
      formDataOf({ ...validBase, schedule: JSON.stringify({ monday: ["08:00-18:00"] }) }),
    );

    expect(result.error).toBeTruthy();
    expect(sb.insert).not.toHaveBeenCalled();
  });
});

describe("updateLocation — latent bug fix (schedule survives edit)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SCEN-009 (server): persists the provided schedule, never {}", async () => {
    const sb = await withSupabase();
    const { updateLocation } = await import("@/lib/actions/locations");

    const schedule = { mon: ["08:00-18:00"], sat: ["08:00-13:00"] };
    const result = await updateLocation(
      "loc-1",
      formDataOf({ ...validBase, name: "Renombrada", schedule: JSON.stringify(schedule) }),
    );

    expect(result).toEqual({});
    const payload = sb.update.mock.calls[0][0];
    expect(payload.schedule.mon).toEqual(["08:00-18:00"]);
    expect(payload.schedule.sat).toEqual(["08:00-13:00"]);
    expect(payload.schedule).not.toEqual({});
    expect(payload.schedule.display).toContain("Lun");
    expect(sb.eq).toHaveBeenCalledWith("id", "loc-1");
  });
});
