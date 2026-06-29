import { describe, it, expect, vi } from "vitest";
import {
  isTransientNetworkError,
  withSupabaseRetry,
  withTimeout,
} from "@/lib/chat/db-resilience";

describe("isTransientNetworkError", () => {
  it("matches the PostgrestError-shaped fetch failure supabase returns", () => {
    // The exact shape seen in prod logs: a returned `{ error }`, not a throw.
    expect(
      isTransientNetworkError({
        message: "TypeError: fetch failed",
        details:
          "TypeError: fetch failed\nCaused by: SocketError: other side closed (UND_ERR_SOCKET)",
        hint: "",
        code: "",
      }),
    ).toBe(true);
  });

  it("matches ECONNRESET/ETIMEDOUT by code", () => {
    expect(isTransientNetworkError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientNetworkError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientNetworkError({ code: "UND_ERR_SOCKET" })).toBe(true);
  });

  it("walks the Error cause chain", () => {
    const err = new Error("fetch failed", {
      cause: Object.assign(new Error("boom"), { code: "ECONNRESET" }),
    });
    expect(isTransientNetworkError(err)).toBe(true);
  });

  it("does NOT match a real PostgREST error (constraint violation)", () => {
    expect(
      isTransientNetworkError({
        message: 'duplicate key value violates unique constraint "x"',
        code: "23505",
      }),
    ).toBe(false);
  });

  it("is total on null/undefined/odd input", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError(42)).toBe(false);
  });
});

describe("withSupabaseRetry", () => {
  const transient = { message: "TypeError: fetch failed" };

  it("returns immediately on success (no retry)", async () => {
    const fn = vi.fn().mockResolvedValue({ error: null, data: 1 });
    const r = await withSupabaseRetry(fn, { baseDelayMs: 0 });
    expect(r).toEqual({ error: null, data: 1 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries a transient RETURNED error then succeeds", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ error: transient })
      .mockResolvedValueOnce({ error: null, data: "ok" });
    const r = await withSupabaseRetry(fn, { baseDelayMs: 0 });
    expect(r).toEqual({ error: null, data: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries a transient THROWN error then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }),
      )
      .mockResolvedValueOnce({ error: null });
    const r = await withSupabaseRetry(fn, { baseDelayMs: 0 });
    expect(r).toEqual({ error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-transient returned error", async () => {
    const fn = vi.fn().mockResolvedValue({ error: { code: "23505" } });
    const r = await withSupabaseRetry(fn, { baseDelayMs: 0, retries: 2 });
    expect(r).toEqual({ error: { code: "23505" } });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("gives up after `retries` and returns the last transient result", async () => {
    const fn = vi.fn().mockResolvedValue({ error: transient });
    const r = await withSupabaseRetry(fn, { baseDelayMs: 0, retries: 2 });
    expect(r).toEqual({ error: transient });
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });
});

describe("withTimeout", () => {
  it("resolves when the op is fast", async () => {
    const r = await withTimeout(() => Promise.resolve("fast"), 1000);
    expect(r).toBe("fast");
  });

  it("rejects when the op exceeds the deadline", async () => {
    await expect(
      withTimeout(() => new Promise((res) => setTimeout(() => res("slow"), 50)), 10),
    ).rejects.toThrow(/timeout/i);
  });
});
