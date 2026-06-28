import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getClientIp,
  loadRateLimitConfig,
  checkRateLimit,
  findRecentDuplicate,
} from "@/lib/api/reservation-guards";

// Guards for reservation creation (synthetic-wave fix, jun 2026). Invariant
// under test across the board: guards FAIL OPEN — a DB error must never block a
// booking.

function reqWithHeaders(headers: Record<string, string>): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Request;
}

describe("getClientIp", () => {
  it("takes the left-most IP from x-forwarded-for", () => {
    expect(getClientIp(reqWithHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(getClientIp(reqWithHeaders({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("returns 'unknown' when no proxy headers present", () => {
    expect(getClientIp(reqWithHeaders({}))).toBe("unknown");
  });
});

describe("loadRateLimitConfig", () => {
  it("uses safe defaults when env unset", () => {
    expect(loadRateLimitConfig({} as NodeJS.ProcessEnv)).toEqual({
      ipPerHour: 15,
      docPerHour: 5,
      dedupWindowSeconds: 600,
    });
  });

  it("overrides from env and ignores invalid values", () => {
    const cfg = loadRateLimitConfig({
      RESERVATION_RATE_LIMIT_IP_PER_HOUR: "30",
      RESERVATION_RATE_LIMIT_DOC_PER_HOUR: "abc", // invalid → default
      RESERVATION_DEDUP_WINDOW_SECONDS: "0", // non-positive → default
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ ipPerHour: 30, docPerHour: 5, dedupWindowSeconds: 600 });
  });
});

function rpcClient(impl: () => Promise<unknown>) {
  return { rpc: vi.fn(impl) } as never;
}

describe("checkRateLimit", () => {
  it("returns true when the RPC reports allowed", async () => {
    const sb = rpcClient(async () => ({ data: [{ allowed: true, remaining: 4 }], error: null }));
    await expect(checkRateLimit(sb, "resv:doc:1", 5, 3600)).resolves.toBe(true);
  });

  it("returns false when the RPC reports not allowed", async () => {
    const sb = rpcClient(async () => ({ data: [{ allowed: false, remaining: 0 }], error: null }));
    await expect(checkRateLimit(sb, "resv:doc:1", 5, 3600)).resolves.toBe(false);
  });

  it("FAILS OPEN (true) on RPC error", async () => {
    const sb = rpcClient(async () => ({ data: null, error: { message: "boom" } }));
    await expect(checkRateLimit(sb, "resv:doc:1", 5, 3600)).resolves.toBe(true);
  });

  it("FAILS OPEN (true) when the RPC throws", async () => {
    const sb = rpcClient(async () => { throw new Error("network"); });
    await expect(checkRateLimit(sb, "resv:doc:1", 5, 3600)).resolves.toBe(true);
  });
});

// Chainable stub for: from().select().eq()...neq().gte().limit() → {data,error}
function dupClient(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "gte"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.limit = limit;
  const from = vi.fn(() => chain);
  return { sb: { from } as never, from, limit };
}

describe("findRecentDuplicate", () => {
  const key = {
    customerId: "cust-1",
    pickupDate: "2026-07-10",
    returnDate: "2026-07-14",
    categoryCode: "C",
    franchise: "alquilatucarro",
    withinSeconds: 600,
  };

  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-06-28T12:00:00Z")));
  afterEach(() => vi.useRealTimers());

  it("returns the match when an identical non-cancelled reservation exists", async () => {
    const { sb } = dupClient({ data: [{ id: "r1", reservation_code: "AVX", status: "reservado" }], error: null });
    await expect(findRecentDuplicate(sb, key)).resolves.toEqual({
      id: "r1", reservation_code: "AVX", status: "reservado",
    });
  });

  it("returns null when no match (e.g. only a cancelled one — filtered by neq)", async () => {
    const { sb } = dupClient({ data: [], error: null });
    await expect(findRecentDuplicate(sb, key)).resolves.toBeNull();
  });

  it("FAILS OPEN (null) on query error", async () => {
    const { sb } = dupClient({ data: null, error: { message: "boom" } });
    await expect(findRecentDuplicate(sb, key)).resolves.toBeNull();
  });
});
