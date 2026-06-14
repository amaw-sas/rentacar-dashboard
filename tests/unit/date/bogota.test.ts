import { describe, it, expect } from "vitest";
import {
  bogotaStartOfDayISO,
  bogotaStartOfWeekISO,
  bogotaStartOfMonthISO,
  bogotaDayStartISO,
  bogotaDayEndISO,
  bogotaTodayYMD,
  bogotaYesterdayYMD,
  bogotaStartOfWeekYMD,
  bogotaStartOfMonthYMD,
  bogotaEndOfMonthYMD,
  resolveDashboardRange,
} from "@/lib/date/bogota";

// Colombia is UTC-5 fixed (no DST), so every "start" instant is 05:00Z of the
// corresponding Bogota calendar date.
describe("bogota date boundaries", () => {
  describe("bogotaStartOfDayISO", () => {
    it("anchors to 00:00 Colombia, not 00:00 UTC (SCEN-A1)", () => {
      // 23:00 on Jun 9 Colombia == 04:00Z on Jun 10.
      const now = new Date("2026-06-09T23:00:00-05:00");
      expect(bogotaStartOfDayISO(now)).toBe("2026-06-09T05:00:00.000Z");
    });

    // The bug this issue fixes: a reservation created in the 19:00–24:00 window
    // (Colombia) must count on that Colombia day, not slip to the next one.
    it("counts a 22:00-Colombia reservation in the same Colombia day (SCEN-A2)", () => {
      const createdAt = new Date("2026-06-09T22:00:00-05:00");
      // Its UTC calendar date is already Jun 10 — the trap the old code fell into.
      expect(createdAt.toISOString()).toBe("2026-06-10T03:00:00.000Z");

      const startJun9 = bogotaStartOfDayISO(new Date("2026-06-09T12:00:00-05:00"));
      const startJun10 = bogotaStartOfDayISO(new Date("2026-06-10T12:00:00-05:00"));

      expect(createdAt.toISOString() >= startJun9).toBe(true);
      expect(createdAt.toISOString() < startJun10).toBe(true);
    });
  });

  describe("bogotaStartOfMonthISO", () => {
    it("returns the first day of the Colombia month (SCEN-A3)", () => {
      const now = new Date("2026-06-09T23:00:00-05:00");
      expect(bogotaStartOfMonthISO(now)).toBe("2026-06-01T05:00:00.000Z");
    });
  });

  describe("bogotaStartOfWeekISO", () => {
    it("returns Monday for a mid-week day (SCEN-A4: Tuesday)", () => {
      const tuesday = new Date("2026-06-09T12:00:00-05:00");
      expect(bogotaStartOfWeekISO(tuesday)).toBe("2026-06-08T05:00:00.000Z");
    });

    it("wraps Sunday back to the prior Monday (SCEN-A4: Sunday)", () => {
      const sunday = new Date("2026-06-14T12:00:00-05:00");
      expect(bogotaStartOfWeekISO(sunday)).toBe("2026-06-08T05:00:00.000Z");
    });

    it("crosses the month boundary correctly (SCEN-A4: Wed Jul 1)", () => {
      const wednesday = new Date("2026-07-01T12:00:00-05:00");
      expect(bogotaStartOfWeekISO(wednesday)).toBe("2026-06-29T05:00:00.000Z");
    });

    it("crosses the year boundary correctly (Fri Jan 1 2027 → prior Dec)", () => {
      const friday = new Date("2027-01-01T12:00:00-05:00");
      expect(bogotaStartOfWeekISO(friday)).toBe("2026-12-28T05:00:00.000Z");
    });

    it("returns the same Monday when the input is already Monday", () => {
      const monday = new Date("2026-06-08T12:00:00-05:00");
      expect(bogotaStartOfWeekISO(monday)).toBe("2026-06-08T05:00:00.000Z");
    });
  });

  // Civil-date → instant bounds for the reservations "Creación" range filter
  // (issue #115). A Colombia day "YYYY-MM-DD" spans 05:00Z of that date to
  // 04:59:59.999Z of the next UTC day.
  describe("bogotaDayStartISO / bogotaDayEndISO", () => {
    it("maps a civil date to its 00:00 Colombia instant (05:00Z)", () => {
      expect(bogotaDayStartISO("2026-06-02")).toBe("2026-06-02T05:00:00.000Z");
    });

    it("maps a civil date to its last-millisecond Colombia instant", () => {
      expect(bogotaDayEndISO("2026-06-09")).toBe("2026-06-10T04:59:59.999Z");
    });

    it("crosses the year boundary for the end bound (Dec 31 → Jan 1 04:59…Z)", () => {
      expect(bogotaDayEndISO("2026-12-31")).toBe("2027-01-01T04:59:59.999Z");
    });

    // The reported bug: filtering "from 2 jun" must NOT include a reservation
    // created 1 jun 7:02 p.m. Colombia (= 2 jun 00:02 UTC).
    it("excludes a 1-jun-19:02-Colombia reservation from a [2 jun, 9 jun] range", () => {
      const createdAt = new Date("2026-06-01T19:02:00-05:00").toISOString();
      expect(createdAt).toBe("2026-06-02T00:02:00.000Z"); // the UTC-day trap
      const start = bogotaDayStartISO("2026-06-02");
      expect(createdAt >= start).toBe(false); // correctly below the lower bound
    });

    it("includes the inclusive Colombia-day edges and excludes just outside", () => {
      const start = bogotaDayStartISO("2026-06-02");
      const end = bogotaDayEndISO("2026-06-09");

      const lowerEdge = new Date("2026-06-02T00:30:00-05:00").toISOString();
      const upperEdge = new Date("2026-06-09T23:30:00-05:00").toISOString();
      const justBelow = new Date("2026-06-01T23:00:00-05:00").toISOString();
      const justAbove = new Date("2026-06-10T00:00:00-05:00").toISOString();

      expect(lowerEdge >= start && lowerEdge <= end).toBe(true);
      expect(upperEdge >= start && upperEdge <= end).toBe(true);
      expect(justBelow >= start).toBe(false);
      expect(justAbove <= end).toBe(false);
    });
  });

  // Civil-date helpers (issue #114 dashboard cards): plain "YYYY-MM-DD" in
  // Colombia time, used for URL date params and the pickup_date (`date` column)
  // filter. All anchored to the Bogota calendar date, not the UTC one.
  describe("bogotaTodayYMD", () => {
    it("returns the Colombia calendar date, not the UTC one", () => {
      // 22:00 Jun 9 Colombia == 03:00Z Jun 10. Must read as Jun 9, not Jun 10.
      const now = new Date("2026-06-09T22:00:00-05:00");
      expect(bogotaTodayYMD(now)).toBe("2026-06-09");
    });
  });

  describe("bogotaYesterdayYMD", () => {
    it("returns the prior Colombia day", () => {
      const now = new Date("2026-06-09T12:00:00-05:00");
      expect(bogotaYesterdayYMD(now)).toBe("2026-06-08");
    });

    it("uses the Colombia date even late at night (22:00 → still prior day)", () => {
      const now = new Date("2026-06-09T22:00:00-05:00"); // 03:00Z Jun 10
      expect(bogotaYesterdayYMD(now)).toBe("2026-06-08");
    });

    it("crosses the month boundary (Jun 1 → May 31)", () => {
      expect(bogotaYesterdayYMD(new Date("2026-06-01T12:00:00-05:00"))).toBe(
        "2026-05-31"
      );
    });

    it("crosses the year boundary (Jan 1 2027 → Dec 31 2026)", () => {
      expect(bogotaYesterdayYMD(new Date("2027-01-01T12:00:00-05:00"))).toBe(
        "2026-12-31"
      );
    });
  });

  describe("bogotaStartOfWeekYMD", () => {
    it("returns Monday for a Tuesday", () => {
      expect(bogotaStartOfWeekYMD(new Date("2026-06-09T12:00:00-05:00"))).toBe(
        "2026-06-08"
      );
    });

    it("wraps Sunday back to the prior Monday", () => {
      expect(bogotaStartOfWeekYMD(new Date("2026-06-14T12:00:00-05:00"))).toBe(
        "2026-06-08"
      );
    });
  });

  describe("bogotaStartOfMonthYMD / bogotaEndOfMonthYMD", () => {
    it("spans the full current month (June → 01..30)", () => {
      const now = new Date("2026-06-09T12:00:00-05:00");
      expect(bogotaStartOfMonthYMD(now)).toBe("2026-06-01");
      expect(bogotaEndOfMonthYMD(now)).toBe("2026-06-30");
    });

    it("handles a 31-day month (July → 31)", () => {
      expect(bogotaEndOfMonthYMD(new Date("2026-07-15T12:00:00-05:00"))).toBe(
        "2026-07-31"
      );
    });

    it("handles February in a non-leap year (28)", () => {
      expect(bogotaEndOfMonthYMD(new Date("2026-02-10T12:00:00-05:00"))).toBe(
        "2026-02-28"
      );
    });

    it("handles February in a leap year (29)", () => {
      expect(bogotaEndOfMonthYMD(new Date("2028-02-10T12:00:00-05:00"))).toBe(
        "2028-02-29"
      );
    });

    it("handles December (end-of-year rollover → 31)", () => {
      expect(bogotaEndOfMonthYMD(new Date("2026-12-10T12:00:00-05:00"))).toBe(
        "2026-12-31"
      );
    });
  });

  // Trend-chart period resolution. Bounds are inclusive Bogota civil dates; the
  // upper bound is "today" (not month/week end) so the chart never trails future
  // days at 0.
  describe("resolveDashboardRange", () => {
    const tuesday = new Date("2026-06-09T12:00:00-05:00");

    it("week → Monday of this week .. today", () => {
      expect(resolveDashboardRange("week", undefined, undefined, tuesday)).toEqual(
        { fromYMD: "2026-06-08", toYMD: "2026-06-09" }
      );
    });

    it("month → first of this month .. today", () => {
      expect(
        resolveDashboardRange("month", undefined, undefined, tuesday)
      ).toEqual({ fromYMD: "2026-06-01", toYMD: "2026-06-09" });
    });

    it("custom → uses the given valid params verbatim", () => {
      expect(
        resolveDashboardRange("custom", "2026-05-01", "2026-05-31", tuesday)
      ).toEqual({ fromYMD: "2026-05-01", toYMD: "2026-05-31" });
    });

    it("custom → swaps a reversed range so from <= to", () => {
      expect(
        resolveDashboardRange("custom", "2026-05-31", "2026-05-01", tuesday)
      ).toEqual({ fromYMD: "2026-05-01", toYMD: "2026-05-31" });
    });

    it("custom → falls back to week when a param is missing or malformed", () => {
      const week = { fromYMD: "2026-06-08", toYMD: "2026-06-09" };
      expect(resolveDashboardRange("custom", "2026-05-01", undefined, tuesday)).toEqual(
        week
      );
      expect(resolveDashboardRange("custom", "nope", "2026-05-01", tuesday)).toEqual(
        week
      );
    });
  });
});
