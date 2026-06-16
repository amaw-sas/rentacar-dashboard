import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callLocalizaAPI } from "../client";
import { LocalizaTimeoutError } from "../errors";

// getConfig() reads these; set minimal valid values so the call reaches fetch.
const ENV = {
  LOCALIZA_ENDPOINT: "https://localiza.example/soap",
  LOCALIZA_USERNAME: "u",
  LOCALIZA_PASSWORD: "p",
  LOCALIZA_TOKEN: "t",
  LOCALIZA_REQUESTOR_ID: "r",
};

describe("callLocalizaAPI", () => {
  beforeEach(() => {
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // SCEN-3A: AbortSignal.timeout cannot be driven by fake timers (host timer),
  // so the signal is injectable. A fetch that LISTENS to the signal and rejects
  // with an AbortError on abort proves the wiring; controller.abort() stands in
  // for the deadline firing.
  it("throws LocalizaTimeoutError when the injected signal aborts", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) throw new Error("fetch called without a signal");
          signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = callLocalizaAPI("action", "<xml/>", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(LocalizaTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The signal must actually be passed through to fetch.
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  // A non-abort fetch rejection (e.g. real network error) is NOT a timeout —
  // it must propagate as-is so mapLocalizaError maps it to the generic 502.
  it("propagates a non-abort fetch error unchanged (not a timeout)", async () => {
    const networkError = new Error("ECONNREFUSED");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(networkError)),
    );

    await expect(
      callLocalizaAPI("action", "<xml/>", { signal: new AbortController().signal }),
    ).rejects.toBe(networkError);
  });

  // SCEN-3A, slow-body case: AbortSignal.timeout stays armed across the WHOLE
  // fetch lifecycle. If Localiza flushes headers fast then stalls the body, the
  // abort fires during response.text() — which must STILL map to a timeout, not
  // leak a raw DOMException to the generic 502 branch.
  it("maps an abort during the response body read to LocalizaTimeoutError", async () => {
    const slowBodyResponse = {
      ok: true,
      status: 200,
      text: () =>
        Promise.reject(
          new DOMException("The operation was aborted", "TimeoutError"),
        ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(slowBodyResponse)),
    );

    await expect(
      callLocalizaAPI("action", "<xml/>", { signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(LocalizaTimeoutError);
  });

  // A malformed LOCALIZA_TIMEOUT_MS must not crash the call with a synchronous
  // RangeError from AbortSignal.timeout(NaN). It falls back to the default.
  it("falls back to the default timeout when LOCALIZA_TIMEOUT_MS is non-numeric", async () => {
    process.env.LOCALIZA_TIMEOUT_MS = "garbage";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("<a/>") })),
    );
    // No injected signal → exercises the default AbortSignal.timeout(timeoutMs).
    await expect(callLocalizaAPI("action", "<xml/>")).resolves.toBeDefined();
    delete process.env.LOCALIZA_TIMEOUT_MS;
  });

  it("falls back to the default timeout when LOCALIZA_TIMEOUT_MS is empty", async () => {
    process.env.LOCALIZA_TIMEOUT_MS = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("<a/>") })),
    );
    await expect(callLocalizaAPI("action", "<xml/>")).resolves.toBeDefined();
    delete process.env.LOCALIZA_TIMEOUT_MS;
  });
});
