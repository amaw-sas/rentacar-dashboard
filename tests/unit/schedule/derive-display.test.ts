import { describe, it, expect } from "vitest";
import {
  deriveScheduleDisplay,
  stripDisplay,
} from "@/lib/schedule/derive-display";
import { parseSchedule } from "@/scripts/migration/parse-schedule";
import { type LocationSchedule } from "@/lib/schemas/location";
import scheduleDump from "@/docs/migration-runs/schedule-dump-2026-06-17.json";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "hol"] as const;

/** Drop closed (absent/[]) keys and `display`, leaving only days with ranges. */
function normalize(s: LocationSchedule): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of DAY_KEYS) {
    const v = s[k];
    if (Array.isArray(v) && v.length > 0) out[k] = v;
  }
  return out;
}

/** The round-trip property: derive must produce a display the D2 parser accepts,
 * and re-parsing must reproduce the same structured schedule (modulo closed/display). */
function assertRoundTrip(s: LocationSchedule) {
  const display = deriveScheduleDisplay(s);
  expect(() => parseSchedule(display)).not.toThrow();
  expect(normalize(parseSchedule(display))).toEqual(normalize(s));
}

describe("deriveScheduleDisplay — display text", () => {
  it("SCEN-007: fuses sun+hol closed into 'Dom y fest Cerrado'", () => {
    const s: LocationSchedule = {
      mon: ["08:00-18:00"],
      tue: ["08:00-18:00"],
      wed: ["08:00-18:00"],
      thu: ["08:00-18:00"],
      fri: ["08:00-18:00"],
      sat: ["08:00-13:00"],
      // sun absent (closed), hol absent (closed)
    };
    expect(deriveScheduleDisplay(s)).toBe(
      "Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado"
    );
  });

  it("SCEN-012: solo-hol preserves the holiday, week shown closed", () => {
    const s: LocationSchedule = { hol: ["08:00-18:00"] };
    expect(deriveScheduleDisplay(s)).toBe("Lun-Dom Cerrado | Fest 08:00-18:00");
  });

  it("returns '' for a fully empty week (all days + hol absent)", () => {
    expect(deriveScheduleDisplay({})).toBe("");
    expect(
      deriveScheduleDisplay({ mon: [], tue: [], hol: [] })
    ).toBe("");
  });

  it("emits the exact '24 horas' token (not '24 h')", () => {
    const s: LocationSchedule = { mon: ["00:00-24:00"] };
    const out = deriveScheduleDisplay(s);
    expect(out).toContain("24 horas");
    expect(out).not.toContain("24 h ");
  });

  it("collapses consecutive equal weekdays into a span", () => {
    const s: LocationSchedule = {
      mon: ["08:00-18:00"],
      tue: ["08:00-18:00"],
      wed: ["08:00-18:00"],
      thu: ["08:00-18:00"],
      fri: ["08:00-18:00"],
    };
    expect(deriveScheduleDisplay(s)).toContain("Lun-Vie 08:00-18:00");
  });

  it("ignores an incoming `display` key in the input", () => {
    const s = {
      mon: ["08:00-18:00"],
      display: "GARBAGE",
    } as unknown as LocationSchedule;
    const out = deriveScheduleDisplay(s);
    expect(out).not.toContain("GARBAGE");
    expect(out).toBe("Lun 08:00-18:00 | Mar-Dom y fest Cerrado");
  });
});

describe("deriveScheduleDisplay — normalized round-trip over the editor state space", () => {
  const R = "08:00-18:00";
  const cases: Record<string, LocationSchedule> = {
    "all-closed": { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], hol: [] },
    "all-24h": {
      mon: ["00:00-24:00"], tue: ["00:00-24:00"], wed: ["00:00-24:00"],
      thu: ["00:00-24:00"], fri: ["00:00-24:00"], sat: ["00:00-24:00"],
      sun: ["00:00-24:00"], hol: ["00:00-24:00"],
    },
    "same-range-all": {
      mon: [R], tue: [R], wed: [R], thu: [R], fri: [R], sat: [R], sun: [R], hol: [R],
    },
    "weekdays-open-weekend-closed": {
      mon: [R], tue: [R], wed: [R], thu: [R], fri: [R],
    },
    "single-day-open": { wed: [R] },
    "intermediate-closed": { mon: [R], wed: [R] },
    "hol-equals-sun": {
      mon: [R], tue: [R], wed: [R], thu: [R], fri: [R],
      sat: ["08:00-13:00"], sun: ["08:00-13:00"], hol: ["08:00-13:00"],
    },
    "hol-differs": {
      mon: [R], tue: [R], wed: [R], thu: [R], fri: [R], sat: [R], sun: [R],
      hol: ["08:00-13:00"],
    },
    "solo-hol": { hol: [R] },
  };

  for (const [name, s] of Object.entries(cases)) {
    it(`round-trips: ${name}`, () => {
      assertRoundTrip(s);
    });
  }
});

describe("deriveScheduleDisplay — round-trip over the real D2 corpus (regression)", () => {
  const rows = scheduleDump as Array<{ code: string; schedule: { display?: string } }>;

  for (const row of rows) {
    it(`round-trips D2 row ${row.code}`, () => {
      // Parse the original D2 free-text into structured, then assert derive
      // reproduces a display that re-parses to the same structured.
      const structured = parseSchedule(row.schedule?.display);
      assertRoundTrip(structured);
    });
  }
});

describe("stripDisplay", () => {
  it("removes the display key, keeping day keys", () => {
    const s = {
      mon: ["08:00-18:00"],
      sat: ["08:00-13:00"],
      display: "Lun 08:00-18:00",
    } as unknown as LocationSchedule;
    expect(stripDisplay(s)).toEqual({
      mon: ["08:00-18:00"],
      sat: ["08:00-13:00"],
    });
    expect(stripDisplay(s)).not.toHaveProperty("display");
  });
});
