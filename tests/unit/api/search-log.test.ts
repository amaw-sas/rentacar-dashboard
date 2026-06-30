import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  splitIsoDateTime,
  buildSearchLogRow,
  searchLogContextSchema,
  type AvailabilitySearchLogInput,
} from "@/lib/api/search-log";

// Issue #206: the search_logs producer. These tests encode the observable
// scenarios from docs/specs/2026-06-30-search-logs-producer-design.md.

const BASE: AvailabilitySearchLogInput = {
  pickupLocation: "BOG01",
  returnLocation: "MDE02",
  pickupDateTime: "2026-07-01T10:30",
  returnDateTime: "2026-07-05T18:00",
  franchise: "alquilatucarro",
  availableCategories: [
    { categoryCode: "C", price: 100 },
    { categoryCode: "G", price: 200 },
  ],
};

describe("splitIsoDateTime", () => {
  it("splits a bare local datetime without timezone shift", () => {
    expect(splitIsoDateTime("2026-07-01T10:30")).toEqual({
      date: "2026-07-01",
      hour: "10:30:00",
    });
  });

  it("tolerates a trailing seconds / timezone suffix", () => {
    expect(splitIsoDateTime("2026-07-01T10:30:45-05:00")).toEqual({
      date: "2026-07-01",
      hour: "10:30:00",
    });
  });

  it("returns null for malformed input", () => {
    expect(splitIsoDateTime("2026-07-01")).toBeNull(); // no time
    expect(splitIsoDateTime("not-a-date")).toBeNull();
    expect(splitIsoDateTime(undefined)).toBeNull();
    expect(splitIsoDateTime(12345)).toBeNull();
  });
});

describe("buildSearchLogRow", () => {
  // SCEN-1: franchise + N results → a complete row.
  it("builds a row with split date/hour and total_results = N", () => {
    const row = buildSearchLogRow(BASE);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      franchise: "alquilatucarro",
      pickup_location_code: "BOG01",
      return_location_code: "MDE02",
      pickup_date: "2026-07-01",
      pickup_hour: "10:30:00",
      return_date: "2026-07-05",
      return_hour: "18:00:00",
      is_monthly: false,
      referral_code: null,
      total_results: 2,
      selected_category_code: null,
      converted_to_reservation: false,
      session_id: null,
      user_agent: null,
      ip_address: null,
    });
    expect(row!.available_categories).toHaveLength(2);
  });

  it("carries optional context: referral, session, monthly, headers", () => {
    const row = buildSearchLogRow({
      ...BASE,
      referralCode: "PARTNER7",
      sessionId: "sess-abc",
      isMonthly: true,
      userAgent: "Mozilla/5.0",
      ipAddress: "190.0.0.1",
    });
    expect(row).toMatchObject({
      referral_code: "PARTNER7",
      session_id: "sess-abc",
      is_monthly: true,
      user_agent: "Mozilla/5.0",
      ip_address: "190.0.0.1",
    });
  });

  // SCEN-2: no franchise → skip (null), so the route writes zero rows.
  it("returns null when franchise is absent or blank", () => {
    expect(buildSearchLogRow({ ...BASE, franchise: undefined })).toBeNull();
    expect(buildSearchLogRow({ ...BASE, franchise: "   " })).toBeNull();
  });

  // SCEN-4: empty result array → still a valid row (demand-with-no-supply signal).
  it("builds a row with total_results = 0 for an empty array", () => {
    const row = buildSearchLogRow({ ...BASE, availableCategories: [] });
    expect(row).not.toBeNull();
    expect(row!.total_results).toBe(0);
    expect(row!.available_categories).toEqual([]);
  });

  // SCEN-5: malformed datetime → skip, never a corrupt row.
  it("returns null when a datetime is unparseable", () => {
    expect(
      buildSearchLogRow({ ...BASE, pickupDateTime: "garbage" }),
    ).toBeNull();
    expect(
      buildSearchLogRow({ ...BASE, returnDateTime: "2026-07-05" }),
    ).toBeNull();
  });
});

describe("searchLogContextSchema", () => {
  it("accepts the original 4-field payload (no context) — backward compatible", () => {
    const parsed = searchLogContextSchema.safeParse({
      pickupLocation: "BOG01",
      returnLocation: "BOG01",
      pickupDateTime: "2026-07-01T10:00",
      returnDateTime: "2026-07-05T10:00",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.franchise).toBeUndefined();
  });

  it("extracts context fields when present", () => {
    const parsed = searchLogContextSchema.safeParse({
      franchise: "alquicarros",
      referralCode: "R1",
      sessionId: "s1",
      isMonthly: true,
    });
    expect(parsed.success && parsed.data).toMatchObject({
      franchise: "alquicarros",
      referralCode: "R1",
      sessionId: "s1",
      isMonthly: true,
    });
  });
});

describe("logAvailabilitySearch (fire-and-forget)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("inserts the built row via the admin client on the happy path", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ insert }) }),
    }));
    const { logAvailabilitySearch: log } = await import("@/lib/api/search-log");

    await log(BASE);

    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0][0]).toMatchObject({
      franchise: "alquilatucarro",
      total_results: 2,
    });
  });

  // SCEN-2: skip path never touches the admin client.
  it("does NOT insert when franchise is absent", async () => {
    const insert = vi.fn();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: () => ({ insert }) }),
    }));
    const { logAvailabilitySearch: log } = await import("@/lib/api/search-log");

    await expect(log({ ...BASE, franchise: undefined })).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  // SCEN-3: a DB failure is swallowed — never throws into the caller (the route).
  it("swallows an insert error without throwing", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({ insert: vi.fn().mockResolvedValue({ error: { message: "db down" } }) }),
      }),
    }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logAvailabilitySearch: log } = await import("@/lib/api/search-log");

    await expect(log(BASE)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  // SCEN-3 (variant): a thrown client (e.g. missing env) is swallowed too.
  it("swallows a thrown admin-client error", async () => {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw new Error("missing env");
      },
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { logAvailabilitySearch: log } = await import("@/lib/api/search-log");

    await expect(log(BASE)).resolves.toBeUndefined();
  });
});
