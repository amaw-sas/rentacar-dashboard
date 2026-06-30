import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unit-tests the per-brand chat gate (lib/chat/brand-status.ts): flag off → always on
// (legacy, no DB read); flag on → the table decides; any failure/missing row → OFF (safe).

const h = vi.hoisted(() => ({
  single: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: h.createAdminClient,
}));

import { isChatEnabledForBrand } from "@/lib/chat/brand-status";

// A thenable-free chain: from().select().eq().single() → h.single().
function adminReturning() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = () => chain;
  chain.single = h.single;
  return { from: () => chain };
}

describe("isChatEnabledForBrand", () => {
  const ORIG = process.env.CHAT_BRAND_SWITCH;

  beforeEach(() => {
    vi.clearAllMocks();
    h.createAdminClient.mockReturnValue(adminReturning());
  });
  afterEach(() => {
    process.env.CHAT_BRAND_SWITCH = ORIG;
  });

  it("S1: flag off → enabled (no DB read)", async () => {
    delete process.env.CHAT_BRAND_SWITCH;
    expect(await isChatEnabledForBrand("alquilatucarro")).toBe(true);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("flag set to anything other than 'on' → enabled (no DB read)", async () => {
    process.env.CHAT_BRAND_SWITCH = "true";
    expect(await isChatEnabledForBrand("alquilame")).toBe(true);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("S3: flag on + row enabled=true → enabled", async () => {
    process.env.CHAT_BRAND_SWITCH = "on";
    h.single.mockResolvedValue({ data: { enabled: true }, error: null });
    expect(await isChatEnabledForBrand("alquilatucarro")).toBe(true);
  });

  it("S2: flag on + row enabled=false → disabled", async () => {
    process.env.CHAT_BRAND_SWITCH = "on";
    h.single.mockResolvedValue({ data: { enabled: false }, error: null });
    expect(await isChatEnabledForBrand("alquilatucarro")).toBe(false);
  });

  it("S2: flag on + missing row (no data) → disabled", async () => {
    process.env.CHAT_BRAND_SWITCH = "on";
    h.single.mockResolvedValue({ data: null, error: { message: "no rows" } });
    expect(await isChatEnabledForBrand("alquicarros")).toBe(false);
  });

  it("S6: flag on + thrown error → disabled (never throws)", async () => {
    process.env.CHAT_BRAND_SWITCH = "on";
    h.createAdminClient.mockImplementation(() => {
      throw new Error("missing service key");
    });
    await expect(isChatEnabledForBrand("alquilame")).resolves.toBe(false);
  });
});
