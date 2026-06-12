import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLocalizaReservation,
  ProxyTimeoutError,
  ProxyError,
  ProxyConfigError,
  PROXY_TIMEOUT_MS,
  MAX_DURATION_S,
} from "@/lib/reservation/proxy-client";

const PAYLOAD = {
  pickupLocation: "BOG",
  returnLocation: "MDE",
  pickupDateTime: "2026-07-01T10:00:00",
  returnDateTime: "2026-07-05T10:00:00",
  categoryCode: "EC",
  referenceToken: "TOK-1",
  rateQualifier: "RATE-1",
  customerName: "Jose Perez",
  customerEmail: "jose@example.com",
  customerPhone: "3001234567",
  customerDocument: "123456",
};

describe("createLocalizaReservation", () => {
  beforeEach(() => {
    process.env.LOCALIZA_PROXY_URL = "https://proxy.example";
    process.env.PROXY_API_KEY = "secret";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOCALIZA_PROXY_URL;
    delete process.env.PROXY_API_KEY;
  });

  // SCEN-3C: the dashboard→proxy timeout must abort before Vercel's hard kill.
  it("keeps PROXY_TIMEOUT_MS below the function maxDuration", () => {
    expect(PROXY_TIMEOUT_MS).toBeLessThan(MAX_DURATION_S * 1000);
  });

  // A misconfigured env override at/above maxDuration would make the timeout dead
  // code — it must clamp back to a safe value that preserves the ladder.
  it("clamps an over-ceiling PROXY_TIMEOUT_MS env override", async () => {
    vi.resetModules();
    process.env.PROXY_TIMEOUT_MS = "45000"; // above the 30000ms ceiling
    try {
      const mod = await import("@/lib/reservation/proxy-client");
      expect(mod.PROXY_TIMEOUT_MS).toBeLessThan(mod.MAX_DURATION_S * 1000);
    } finally {
      delete process.env.PROXY_TIMEOUT_MS;
      vi.resetModules();
    }
  });

  // SCEN-3B: an aborted request (proxy exceeded the deadline) throws a
  // distinguishable ProxyTimeoutError. The injected signal stands in for
  // AbortSignal.timeout (a host timer, immune to fake timers); the fetch mock
  // LISTENS to the signal rather than rejecting unconditionally, proving wiring.
  it("throws ProxyTimeoutError when the request is aborted", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error("fetch called without a signal");
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = createLocalizaReservation(PAYLOAD, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(ProxyTimeoutError);
  });

  it("forwards the Idempotency-Key header only when provided", async () => {
    const ok = {
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({ reserveCode: "R1", reservationStatus: "Reserved" }),
        ),
    };
    const fetchMock =
      vi.fn<
        (url: string, init: { headers: Record<string, string> }) => Promise<typeof ok>
      >(() => Promise.resolve(ok));
    vi.stubGlobal("fetch", fetchMock);

    await createLocalizaReservation(PAYLOAD, { idempotencyKey: "KEY-9" });
    const withKeyHeaders = fetchMock.mock.calls[0][1].headers;
    expect(withKeyHeaders["Idempotency-Key"]).toBe("KEY-9");
    expect(withKeyHeaders["x-api-key"]).toBe("secret");

    await createLocalizaReservation(PAYLOAD);
    const noKeyHeaders = fetchMock.mock.calls[1][1].headers;
    expect(noKeyHeaders["Idempotency-Key"]).toBeUndefined();
  });

  it("returns the parsed reserveCode + status on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ reserveCode: "R-7", reservationStatus: "Reserved" }),
            ),
        }),
      ),
    );
    const result = await createLocalizaReservation(PAYLOAD);
    expect(result).toEqual({ reserveCode: "R-7", reservationStatus: "Reserved" });
  });

  // A 200 with an unparseable body throws a typed ProxyError preserving the raw
  // body (likely a created-but-unreadable booking) instead of a bare SyntaxError.
  it("throws ProxyError on a 200 with an unparseable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("<html>oops</html>"),
        }),
      ),
    );
    const err = await createLocalizaReservation(PAYLOAD).catch((e) => e);
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.status).toBe(200);
    expect(err.rawText).toBe("<html>oops</html>");
  });

  // A non-ok proxy response carries its structured body + status so the route can
  // pass it through unchanged (preserving the existing toast behavior).
  it("throws ProxyError carrying the structured body + status on a non-ok response", async () => {
    const body = { error: "no_available_categories_error", message: "Sin disponibilidad" };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve(JSON.stringify(body)),
        }),
      ),
    );
    const err = await createLocalizaReservation(PAYLOAD).catch((e) => e);
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.status).toBe(500);
    expect(err.body).toEqual(body);
  });

  // An abort during the response body read must STILL map to a timeout, not leak
  // a raw DOMException (the body-phase lesson from the proxy client).
  it("maps an abort during the response read to ProxyTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.reject(new DOMException("aborted", "TimeoutError")),
        }),
      ),
    );
    await expect(createLocalizaReservation(PAYLOAD)).rejects.toBeInstanceOf(
      ProxyTimeoutError,
    );
  });

  it("throws ProxyConfigError when proxy env vars are missing", async () => {
    delete process.env.LOCALIZA_PROXY_URL;
    await expect(createLocalizaReservation(PAYLOAD)).rejects.toBeInstanceOf(
      ProxyConfigError,
    );
  });
});
