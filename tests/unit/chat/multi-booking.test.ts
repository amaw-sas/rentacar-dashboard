import { describe, it, expect } from "vitest";
import { bookingConflict, datesOverlap } from "@/lib/chat/orchestrator/blocks";
import type { Booking } from "@/lib/chat/orchestrator/slots";

/** Pure tests for the R3 same-responsible / overlapping-dates rule. */

describe("datesOverlap", () => {
  it("is true when the ranges intersect (incl. touching endpoints)", () => {
    expect(datesOverlap("2026-08-01", "2026-08-10", "2026-08-05", "2026-08-15")).toBe(true);
    expect(datesOverlap("2026-08-01", "2026-08-10", "2026-08-10", "2026-08-20")).toBe(true);
  });
  it("is false when the ranges are disjoint", () => {
    expect(datesOverlap("2026-08-01", "2026-08-10", "2026-08-11", "2026-08-20")).toBe(false);
    expect(datesOverlap("2026-08-20", "2026-08-25", "2026-08-01", "2026-08-10")).toBe(false);
  });
});

describe("bookingConflict", () => {
  const prior: Booking[] = [
    { identification: "1020304050", fecha_recogida: "2026-08-01", fecha_devolucion: "2026-08-06" },
  ];

  it("blocks the same responsible on overlapping dates", () => {
    expect(bookingConflict(prior, "1020304050", "2026-08-03", "2026-08-08")).toBe(true);
  });
  it("allows the same responsible on non-overlapping dates", () => {
    expect(bookingConflict(prior, "1020304050", "2026-08-20", "2026-08-25")).toBe(false);
  });
  it("allows a different responsible on the same dates", () => {
    expect(bookingConflict(prior, "9999999999", "2026-08-01", "2026-08-06")).toBe(false);
  });
  it("is false with no prior bookings or no id/dates", () => {
    expect(bookingConflict([], "1020304050", "2026-08-03", "2026-08-08")).toBe(false);
    expect(bookingConflict(prior, "", "2026-08-03", "2026-08-08")).toBe(false);
    expect(bookingConflict(prior, "1020304050", "", "")).toBe(false);
  });
});
