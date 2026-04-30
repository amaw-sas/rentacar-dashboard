import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_VARS_TO_MANAGE = [
  "ALQUILATUCARRO_RESEND_API_KEY",
  "ALQUILAME_RESEND_API_KEY",
  "ALQUICARROS_RESEND_API_KEY",
];

function snapshotEnv() {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_VARS_TO_MANAGE) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_VARS_TO_MANAGE) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe("getResendClient", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    for (const key of ENV_VARS_TO_MANAGE) {
      delete process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  // SCEN-015: Module load no crashea sin env vars
  it("imports cleanly without any RESEND_API_KEY env vars set", async () => {
    await expect(import("@/lib/email/client")).resolves.toBeDefined();
  });

  // SCEN-002: Franquicia desconocida produce error específico
  it("throws an error containing 'Unknown franchise' for unknown codes", async () => {
    const { getResendClient } = await import("@/lib/email/client");

    expect(() => getResendClient("foo")).toThrow(/Unknown franchise/);
  });

  it("throws 'Unknown franchise' even when other API keys are set", async () => {
    process.env.ALQUILATUCARRO_RESEND_API_KEY = "re_test_key";
    vi.resetModules();
    const { getResendClient } = await import("@/lib/email/client");

    expect(() => getResendClient("nonexistent")).toThrow(/Unknown franchise/);
  });

  // SCEN-003: Franquicia conocida sin API key falla loud (distinto error)
  it("throws an error containing the env var name when API key is missing", async () => {
    const { getResendClient } = await import("@/lib/email/client");

    expect(() => getResendClient("alquicarros")).toThrow(
      /ALQUICARROS_RESEND_API_KEY/
    );
  });

  it("missing API key error does NOT mention 'Unknown franchise' (must be distinguishable)", async () => {
    const { getResendClient } = await import("@/lib/email/client");

    let caughtError: Error | undefined;
    try {
      getResendClient("alquicarros");
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain("ALQUICARROS_RESEND_API_KEY");
    expect(caughtError!.message).not.toContain("Unknown franchise");
  });

  it("throws separate error names for each franchise's missing key", async () => {
    const { getResendClient } = await import("@/lib/email/client");

    expect(() => getResendClient("alquilatucarro")).toThrow(
      /ALQUILATUCARRO_RESEND_API_KEY/
    );
    expect(() => getResendClient("alquilame")).toThrow(
      /ALQUILAME_RESEND_API_KEY/
    );
    expect(() => getResendClient("alquicarros")).toThrow(
      /ALQUICARROS_RESEND_API_KEY/
    );
  });

  // SCEN-001 (partial): with env var set, returns a Resend instance
  it("returns a Resend client when API key is set", async () => {
    process.env.ALQUILATUCARRO_RESEND_API_KEY = "re_test_alquilatucarro";
    vi.resetModules();
    const { getResendClient } = await import("@/lib/email/client");
    const { Resend } = await import("resend");

    const client = getResendClient("alquilatucarro");

    expect(client).toBeInstanceOf(Resend);
  });

  it("uses the franchise-specific API key (not a shared one)", async () => {
    process.env.ALQUILATUCARRO_RESEND_API_KEY = "re_alquilatucarro_key";
    process.env.ALQUILAME_RESEND_API_KEY = "re_alquilame_key";

    // SCEN-015 corollary: alquicarros is intentionally unset
    vi.resetModules();
    const { getResendClient } = await import("@/lib/email/client");

    // Configured franchises return a client (no throw)
    expect(() => getResendClient("alquilatucarro")).not.toThrow();
    expect(() => getResendClient("alquilame")).not.toThrow();
    // Unconfigured franchise throws
    expect(() => getResendClient("alquicarros")).toThrow(
      /ALQUICARROS_RESEND_API_KEY/
    );
  });
});
