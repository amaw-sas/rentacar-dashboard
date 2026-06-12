import { describe, it, expect, vi } from "vitest";
import {
  LocalizaTimeoutError,
  mapLocalizaError,
  UPSTREAM_TIMEOUT_MESSAGE,
} from "../errors";
import { buildLocalizaWarning, LocalizaWarningError } from "../warnings";

// Minimal Express Response double: status() and json() are chainable spies.
function mockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  } as unknown as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  return res;
}

describe("mapLocalizaError", () => {
  // SCEN-3A: a timeout maps to 504 upstream_timeout (not the generic 502).
  it("maps LocalizaTimeoutError to 504 { error: 'upstream_timeout', message }", () => {
    const res = mockRes();
    mapLocalizaError(new LocalizaTimeoutError("timed out"), res);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith({
      error: "upstream_timeout",
      message: UPSTREAM_TIMEOUT_MESSAGE,
    });
  });

  // SCEN-3A-PRESERVE: a non-timeout, non-warning upstream error still returns 502
  // with the raw message — identical to the pre-existing behavior of all three
  // endpoints. A regression to 500 (or dropping the message) fails here.
  it("maps a generic Error to 502 preserving the message", () => {
    const res = mockRes();
    mapLocalizaError(new Error("boom"), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "boom" });
  });

  it("maps a non-Error throwable to 502 with a generic message", () => {
    const res = mockRes();
    mapLocalizaError("weird", res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: "Unknown error" });
  });

  // Business warning path preserved: status = the warning's httpStatus, body = toJSON().
  it("maps a LocalizaWarningError to its httpStatus + toJSON()", () => {
    const res = mockRes();
    const warning: LocalizaWarningError = buildLocalizaWarning("LLNRAG009");
    mapLocalizaError(warning, res);
    expect(res.status).toHaveBeenCalledWith(warning.httpStatus);
    expect(res.json).toHaveBeenCalledWith(warning.toJSON());
  });
});
