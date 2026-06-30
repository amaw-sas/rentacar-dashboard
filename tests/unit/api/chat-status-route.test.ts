import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ isChatEnabledForBrand: vi.fn() }));

vi.mock("@/lib/chat/brand-status", () => ({
  isChatEnabledForBrand: h.isChatEnabledForBrand,
}));

import { GET } from "@/app/api/chat/status/route";

function get(brand?: string): Request {
  const url = brand
    ? `https://x/api/chat/status?brand=${encodeURIComponent(brand)}`
    : "https://x/api/chat/status";
  return new Request(url, { method: "GET" });
}

describe("GET /api/chat/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("S5: missing brand → 400", async () => {
    const res = await GET(get());
    expect(res.status).toBe(400);
    expect(h.isChatEnabledForBrand).not.toHaveBeenCalled();
  });

  it("S5: unknown brand → 400", async () => {
    const res = await GET(get("notabrand"));
    expect(res.status).toBe(400);
    expect(h.isChatEnabledForBrand).not.toHaveBeenCalled();
  });

  it("S3: valid brand enabled → 200 {enabled:true} with CORS", async () => {
    h.isChatEnabledForBrand.mockResolvedValue(true);
    const res = await GET(get("alquilatucarro"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res.json()).resolves.toEqual({
      brand: "alquilatucarro",
      enabled: true,
    });
  });

  it("S2: valid brand disabled → 200 {enabled:false}", async () => {
    h.isChatEnabledForBrand.mockResolvedValue(false);
    const res = await GET(get("alquilame"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      brand: "alquilame",
      enabled: false,
    });
  });
});
