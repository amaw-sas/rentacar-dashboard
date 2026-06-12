import { describe, it, expect, vi, afterEach } from "vitest";
import { deriveKey, withIdempotency } from "../idempotency";

const BODY = {
  customerDocument: "123456",
  pickupLocation: "BOG",
  returnLocation: "MDE",
  pickupDateTime: "2026-07-01T10:00:00",
  returnDateTime: "2026-07-05T10:00:00",
  categoryCode: "EC",
};

// A controllable deferred so concurrent-arrival ordering is deterministic, not
// timing-dependent (plan §Step 2).
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withIdempotency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // SCEN-1A: two identical requests in flight at once → fn runs ONCE, both get
  // the same result.
  it("coalesces concurrent identical requests into a single fn execution", async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const key = "k-coalesce";

    const p1 = withIdempotency(key, fn);
    const p2 = withIdempotency(key, fn);
    d.resolve("RES-123");

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toBe("RES-123");
    expect(r2).toBe("RES-123");
  });

  // SCEN-1B: a success cached within the TTL replays with zero new fn calls.
  it("replays a cached success within the TTL without calling fn again", async () => {
    const fn = vi.fn(() => Promise.resolve("RES-1"));
    const key = "k-replay";

    const r1 = await withIdempotency(key, fn);
    const r2 = await withIdempotency(key, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toBe("RES-1");
    expect(r2).toBe("RES-1");
  });

  // SCEN-1C: a failure is NOT cached. Concurrent waiters share the one rejection
  // (coalesced), but a LATER arrival re-executes fresh.
  it("does not cache a failure; concurrent waiters share it, a later request retries fresh", async () => {
    const key = "k-nopoison";
    const d = deferred<string>();
    const failing = vi.fn(() => d.promise);

    const a = withIdempotency(key, failing);
    const b = withIdempotency(key, failing);
    const err = new Error("upstream down");
    d.reject(err);

    await expect(a).rejects.toBe(err);
    await expect(b).rejects.toBe(err);
    expect(failing).toHaveBeenCalledTimes(1); // coalesced, not cached

    const ok = vi.fn(() => Promise.resolve("RES-OK"));
    const r = await withIdempotency(key, ok);
    expect(ok).toHaveBeenCalledTimes(1); // re-executed fresh
    expect(r).toBe("RES-OK");
  });

  // TTL semantics: after the window expires, the next lookup re-executes.
  it("re-executes after the TTL expires", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce("OLD")
      .mockResolvedValueOnce("NEW");
    const key = "k-expiry";

    expect(await withIdempotency(key, fn)).toBe("OLD");
    vi.advanceTimersByTime(60_001);
    expect(await withIdempotency(key, fn)).toBe("NEW");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Half-open TTL contract: an entry is live on [setTime, setTime+TTL) and dead
  // at exactly setTime+TTL.
  it("treats exactly expiresAt as expired (half-open window)", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValueOnce("OLD").mockResolvedValueOnce("NEW");
    const key = "k-boundary";

    expect(await withIdempotency(key, fn)).toBe("OLD");
    vi.advanceTimersByTime(60_000); // exactly at expiresAt
    expect(await withIdempotency(key, fn)).toBe("NEW");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Resource bound: the success cache must not grow without limit on a long-lived
  // proxy. Past the cap, the OLDEST entry is evicted (FIFO) — observable because
  // a replay of that evicted key re-executes fn instead of serving the cache.
  it("bounds the cache — past the cap the oldest entry is evicted and re-executes", async () => {
    process.env.DEDUPE_MAX_ENTRIES = "2";
    try {
      const fnA = vi.fn().mockResolvedValueOnce("A1").mockResolvedValueOnce("A2");
      await withIdempotency("cap-A", fnA); // cache: [A]
      await withIdempotency("cap-B", () => Promise.resolve("B")); // cache: [A,B]
      await withIdempotency("cap-C", () => Promise.resolve("C")); // inserting C evicts A → [B,C]

      // A was evicted → a replay re-executes fn (not served from cache).
      expect(await withIdempotency("cap-A", fnA)).toBe("A2");
      expect(fnA).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.DEDUPE_MAX_ENTRIES;
    }
  });
});

describe("deriveKey", () => {
  // SCEN-1D: the explicit header is COMBINED with the fingerprint, never an override.
  it("combines the header with the fingerprint (same→same, different header→different, same header+different body→different)", () => {
    expect(deriveKey(BODY, "K1")).toBe(deriveKey(BODY, "K1"));
    expect(deriveKey(BODY, "K1")).not.toBe(deriveKey(BODY, "K2"));
    const otherBody = { ...BODY, categoryCode: "SUV" };
    expect(deriveKey(otherBody, "K1")).not.toBe(deriveKey(BODY, "K1"));
  });

  it("derives a bare fingerprint when no header is given", () => {
    expect(deriveKey(BODY)).toBe(deriveKey(BODY)); // stable
    expect(deriveKey(BODY)).not.toBe(deriveKey(BODY, "K1")); // header changes the key
  });

  it("is sensitive to booking intent (a changed intent field changes the key)", () => {
    expect(deriveKey({ ...BODY, pickupDateTime: "2026-08-01T10:00:00" })).not.toBe(
      deriveKey(BODY),
    );
    expect(deriveKey({ ...BODY, pickupLocation: "CTG" })).not.toBe(deriveKey(BODY));
  });

  // The fingerprint must IGNORE quote artifacts so a reload that re-runs
  // availability (new referenceToken/rateQualifier) still dedupes. deriveKey's
  // param is structural, so excess properties on a variable need no cast.
  it("is insensitive to quote artifacts (referenceToken / rateQualifier)", () => {
    // Presence vs absence is irrelevant — guards against a future regression that
    // adds an artifact to INTENT_FIELDS.
    expect(deriveKey({ ...BODY, referenceToken: "TOK-A" })).toBe(deriveKey(BODY));
    expect(deriveKey({ ...BODY, rateQualifier: "RATE-A" })).toBe(deriveKey(BODY));

    // Different artifact values still collapse to the same key.
    expect(deriveKey({ ...BODY, referenceToken: "TOK-A" })).toBe(
      deriveKey({ ...BODY, referenceToken: "TOK-B" }),
    );
    expect(deriveKey({ ...BODY, rateQualifier: "RATE-A" })).toBe(
      deriveKey({ ...BODY, rateQualifier: "RATE-B" }),
    );
  });
});
