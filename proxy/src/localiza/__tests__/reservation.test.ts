import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Localiza client so createReservation never touches the network. The
// spy lets us count upstream calls (the observable for coalescing).
const { callLocalizaAPIMock } = vi.hoisted(() => ({
  callLocalizaAPIMock: vi.fn(),
}));
vi.mock("../client", () => ({
  callLocalizaAPI: callLocalizaAPIMock,
  getConfig: () => ({
    endpoint: "https://localiza.example/soap",
    username: "u",
    password: "p",
    token: "t",
    requestorId: "r",
  }),
}));

import { createReservation, missingRequiredFields } from "../reservation";

// A parsed OTA_VehResRS shaped so extractReservation finds the reservation code
// (ConfID Type="14") and status.
const PARSED_RESERVED = {
  Envelope: {
    Body: {
      OTA_VehResRS: {
        VehResRSCore: {
          VehReservation: {
            $: { ReservationStatus: "Reserved" },
            VehSegmentCore: {
              ConfID: { $: { Type: "14", ID: "RES-123" } },
            },
          },
        },
      },
    },
  },
};

function makeData(overrides: Record<string, string> = {}) {
  return {
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
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createReservation", () => {
  // Isolation contract: the idempotency cache is module-scoped and NOT reset
  // between tests (no test-only reset export). Each test MUST use a distinct
  // customerDocument so its fingerprint is unique — otherwise it would hit the
  // prior test's 60s TTL replay and observe 0 upstream calls. Keep documents
  // unique per test.
  beforeEach(() => {
    callLocalizaAPIMock.mockReset();
  });

  it("returns the extracted reserveCode + status for a single call", async () => {
    callLocalizaAPIMock.mockResolvedValue(PARSED_RESERVED);
    const result = await createReservation(makeData({ customerDocument: "solo-1" }));
    expect(result).toEqual({ reserveCode: "RES-123", reservationStatus: "Reserved" });
    expect(callLocalizaAPIMock).toHaveBeenCalledTimes(1);
  });

  // SCEN-1A end-to-end: two identical reservations in flight at once collapse to
  // ONE Localiza call, both get the same reserveCode.
  it("coalesces two concurrent identical reservations into one Localiza call", async () => {
    const d = deferred<typeof PARSED_RESERVED>();
    callLocalizaAPIMock.mockReturnValue(d.promise);
    const data = makeData({ customerDocument: "coalesce-doc" });

    const p1 = createReservation(data);
    const p2 = createReservation(data);
    d.resolve(PARSED_RESERVED);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(callLocalizaAPIMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ reserveCode: "RES-123", reservationStatus: "Reserved" });
    expect(r2).toEqual(r1);
  });

  // Distinct bookings (different document) must NOT coalesce.
  it("does not coalesce reservations with different booking intent", async () => {
    callLocalizaAPIMock.mockResolvedValue(PARSED_RESERVED);
    await createReservation(makeData({ customerDocument: "distinct-A" }));
    await createReservation(makeData({ customerDocument: "distinct-B" }));
    expect(callLocalizaAPIMock).toHaveBeenCalledTimes(2);
  });
});

describe("missingRequiredFields", () => {
  it("is false when every required field is present", () => {
    expect(missingRequiredFields(makeData())).toBe(false);
  });

  it("is true when any required field is missing or empty", () => {
    for (const field of [
      "pickupLocation",
      "returnLocation",
      "pickupDateTime",
      "returnDateTime",
      "categoryCode",
      "referenceToken",
      "rateQualifier",
      "customerName",
      "customerEmail",
      "customerPhone",
      "customerDocument",
    ]) {
      expect(missingRequiredFields(makeData({ [field]: "" }))).toBe(true);
    }
  });
});
