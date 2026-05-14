import { describe, it, expect } from "vitest";

import {
  formatRangeLabel,
  isWithinDateRange,
  toLocalIsoDate,
} from "@/lib/date-range";

const date = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

describe("toLocalIsoDate", () => {
  it("SCEN-001 returns YYYY-MM-DD in local calendar terms", () => {
    expect(toLocalIsoDate(new Date(2026, 4, 14))).toBe("2026-05-14");
  });

  it("SCEN-002 zero-pads single-digit month and day", () => {
    expect(toLocalIsoDate(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("isWithinDateRange", () => {
  const created = "2026-05-14T18:30:00.000Z";
  const pickup = "2026-06-20";

  it("SCEN-010 undefined range matches every row", () => {
    expect(isWithinDateRange(created, undefined)).toBe(true);
  });

  it("SCEN-011 partial range (only `from`) is treated as no filter", () => {
    expect(isWithinDateRange(created, { from: date("2026-05-14") })).toBe(true);
    expect(isWithinDateRange(created, { from: date("2027-01-01") })).toBe(true);
  });

  it("SCEN-012 complete range is inclusive on both ends", () => {
    const range = { from: date("2026-06-01"), to: date("2026-06-20") };
    expect(isWithinDateRange(pickup, range)).toBe(true);
    const earlier = { from: date("2026-06-01"), to: date("2026-06-19") };
    expect(isWithinDateRange(pickup, earlier)).toBe(false);
  });

  it("SCEN-013 single-day range (from === to) is a valid filter", () => {
    const range = { from: date("2026-05-14"), to: date("2026-05-14") };
    expect(isWithinDateRange(created, range)).toBe(true);
  });

  it("SCEN-014 row strictly outside the range is filtered out", () => {
    const range = { from: date("2026-05-01"), to: date("2026-05-10") };
    expect(isWithinDateRange(created, range)).toBe(false);
  });

  it("SCEN-015 ISO timestamp is compared by date portion only", () => {
    const lateNight = "2026-05-14T23:59:59.999Z";
    const range = { from: date("2026-05-14"), to: date("2026-05-14") };
    expect(isWithinDateRange(lateNight, range)).toBe(true);
  });

  it("SCEN-016 plain YYYY-MM-DD string is supported", () => {
    const range = { from: date("2026-06-01"), to: date("2026-06-30") };
    expect(isWithinDateRange("2026-06-20", range)).toBe(true);
    expect(isWithinDateRange("2026-07-01", range)).toBe(false);
  });
});

describe("formatRangeLabel", () => {
  it("SCEN-020 returns null when range is undefined", () => {
    expect(formatRangeLabel(undefined)).toBeNull();
  });

  it("SCEN-021 single date when only `from` is set", () => {
    expect(formatRangeLabel({ from: date("2026-05-14") })).toBe("14 may 2026");
  });

  it("SCEN-022 same-year range omits year on `from`", () => {
    const range = { from: date("2026-05-14"), to: date("2026-05-20") };
    expect(formatRangeLabel(range)).toBe("14 may – 20 may 2026");
  });

  it("SCEN-023 cross-year range shows year on both ends", () => {
    const range = { from: date("2025-12-29"), to: date("2026-01-03") };
    expect(formatRangeLabel(range)).toBe("29 dic 2025 – 3 ene 2026");
  });
});
