import { describe, it, expect } from "vitest";
import { parseSchedule } from "@/scripts/migration/parse-schedule";
import { locationScheduleSchema } from "@/lib/schemas/location";

// Snapshot of every real `display` in prod (ilhdholjrnbycyvejsub, 2026-06-17).
// 28 rows with a display string; 4 rows have `schedule = {}` / `null` (no display).
// Source: docs/specs/2026-06-17-issue-96-schedule-data-migration-design.md (NOT the Step 5 dump).
const REAL_DISPLAYS: Array<{ code: string; display: string }> = [
  { code: "AABAN", display: "Todos los días 07:00-20:00" },
  { code: "AABCR", display: "Todos los días 06:30-18:30" },
  { code: "AABOT", display: "Lun-Dom 24 horas | Festivos 06:00-21:00" },
  { code: "AACTG", display: "Todos los días 06:30-20:00" },
  { code: "AACUC", display: "Lun-Vie 07:00-18:00 | Sáb, Dom y fest 08:00-15:00" },
  { code: "AAKAL", display: "Lun-Sáb 06:00-21:00 | Dom y fest 08:00-16:00" },
  { code: "AAMTR", display: "Lun-Vie 07:00-19:00 | Sáb, Dom y fest 08:00-16:00" },
  { code: "AANVA", display: "Lun-Vie 06:30-20:00 | Sáb, Dom y fest 08:00-15:00" },
  { code: "AAPEI", display: "Lun-Vie 06:30-19:30 | Sáb, Dom y fest 08:00-15:00" },
  { code: "AARME", display: "Lun-Vie 06:00-19:00 | Sáb, Dom y fest 08:00-16:00" },
  { code: "AASMR", display: "Todos los días 07:00-21:00" },
  { code: "AAVAL", display: "Lun-Vie 07:00-18:00 | Sáb, Dom y fest 08:00-15:00" },
  { code: "ACBAN", display: "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00" },
  { code: "ACBCR", display: "Lun-Vie 08:00-15:00 | Sáb, Dom y fest 08:00-13:00" },
  { code: "ACBEX", display: "Todos los días 06:30-20:00" },
  { code: "ACBNN", display: "Todos los días 06:30-18:00" },
  { code: "ACBOJ", display: "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00" },
  { code: "ACBSD", display: "Lun-Dom 06:30-20:00" },
  { code: "ACIBG", display: "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00" },
  { code: "ACKAL", display: "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest Cerrado" },
  { code: "ACKJC", display: "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest 08:00-14:00" },
  { code: "ACKPA", display: "Lun-Vie 06:00-20:00 | Sáb, Dom y fest 08:00-15:00" },
  { code: "ACMCL", display: "Lun-Vie 08:00-15:00 | Sáb 08:00-13:00 | Dom y fest Cerrado" },
  { code: "ACMJM", display: "Todos los días 06:00-23:00" },
  { code: "ACMNZ", display: "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00" },
  { code: "ACMTR", display: "Lun-Vie 08:00-15:00 | Sáb, Dom y fest 08:00-13:00" },
  { code: "ACSMR", display: "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00" },
  { code: "ACVLL", display: "Lun-Vie 08:00-16:00 | Sáb, Dom y fest 08:00-13:00" },
];

describe("parseSchedule (issue #96 — schedule text → structured)", () => {
  // SCEN-001 / AC-D2.1
  it("parses week + saturday + closed sunday/holiday", () => {
    const display = "Lun-Vie 08:00-18:00 | Sáb 08:00-13:00 | Dom y fest Cerrado";
    expect(parseSchedule(display)).toEqual({
      mon: ["08:00-18:00"],
      tue: ["08:00-18:00"],
      wed: ["08:00-18:00"],
      thu: ["08:00-18:00"],
      fri: ["08:00-18:00"],
      sat: ["08:00-13:00"],
      sun: [],
      hol: [],
      display,
    });
  });

  // SCEN-002 / AC-D2.2
  it("parses 24 horas sentinel + festivos range", () => {
    const display = "Lun-Dom 24 horas | Festivos 06:00-21:00";
    expect(parseSchedule(display)).toEqual({
      mon: ["00:00-24:00"],
      tue: ["00:00-24:00"],
      wed: ["00:00-24:00"],
      thu: ["00:00-24:00"],
      fri: ["00:00-24:00"],
      sat: ["00:00-24:00"],
      sun: ["00:00-24:00"],
      hol: ["06:00-21:00"],
      display,
    });
  });

  // SCEN-003 / AC-D2.3
  it("returns {} for null/undefined/empty/whitespace", () => {
    expect(parseSchedule(null)).toEqual({});
    expect(parseSchedule(undefined)).toEqual({});
    expect(parseSchedule("")).toEqual({});
    expect(parseSchedule("   ")).toEqual({});
  });

  // SCEN-004 / AC-D2.3b
  it("expands a comma-group to all three days (sat, sun, hol)", () => {
    const display = "Sáb, Dom y fest 08:00-16:00";
    expect(parseSchedule(display)).toEqual({
      sat: ["08:00-16:00"],
      sun: ["08:00-16:00"],
      hol: ["08:00-16:00"],
      display,
    });
  });

  // SCEN-005 / AC-D2.4
  it("preserves the original display literal on every non-empty parse", () => {
    for (const { display } of REAL_DISPLAYS) {
      const result = parseSchedule(display);
      expect(result.display).toBe(display);
    }
  });

  // SCEN-006 / AC-D2.7
  it("every real display parses to a value valid under locationScheduleSchema", () => {
    for (const { code, display } of REAL_DISPLAYS) {
      const result = parseSchedule(display);
      const check = locationScheduleSchema.safeParse(result);
      expect(check.success, `${code}: ${display} → ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it("a literal-null schedule column maps to {} (runner guard parity)", () => {
    const row: { schedule: { display?: string } | null } = { schedule: null };
    expect(parseSchedule(row.schedule?.display ?? null)).toEqual({});
  });

  // SCEN-007 (fail-loud)
  it("throws on an unrecognized day token", () => {
    expect(() => parseSchedule("Lunes 08:00-18:00")).toThrow();
  });

  it("throws on an unrecognized time token", () => {
    expect(() => parseSchedule("Lun-Vie mañanas")).toThrow();
  });

  it("throws on a split-shift / multi-range segment (would drop the morning range)", () => {
    expect(() => parseSchedule("Lun-Vie 08:00-12:00, 14:00-18:00")).toThrow();
  });

  it("throws (named) on an off-grid minute instead of leaking a Zod blob", () => {
    expect(() => parseSchedule("Lun-Vie 08:15-18:00")).toThrow(/08:15-18:00/);
  });

  // SCEN-008 (festivos implícitos)
  it("leaves hol absent when festivos is not mentioned (Todos los días)", () => {
    const result = parseSchedule("Todos los días 07:00-20:00");
    expect(result).toEqual({
      mon: ["07:00-20:00"],
      tue: ["07:00-20:00"],
      wed: ["07:00-20:00"],
      thu: ["07:00-20:00"],
      fri: ["07:00-20:00"],
      sat: ["07:00-20:00"],
      sun: ["07:00-20:00"],
      display: "Todos los días 07:00-20:00",
    });
    expect("hol" in result).toBe(false);
  });

  it("leaves sun and hol absent when only Lun-Vie and Sáb are given", () => {
    const result = parseSchedule("Lun-Vie 08:00-16:00 | Sáb 08:00-13:00");
    expect("sun" in result).toBe(false);
    expect("hol" in result).toBe(false);
    expect(result.mon).toEqual(["08:00-16:00"]);
    expect(result.sat).toEqual(["08:00-13:00"]);
  });

  // Representative real rows — one per pattern family
  it("parses 'Lun-Sáb X | Dom y fest Y' (AAKAL)", () => {
    const display = "Lun-Sáb 06:00-21:00 | Dom y fest 08:00-16:00";
    expect(parseSchedule(display)).toEqual({
      mon: ["06:00-21:00"],
      tue: ["06:00-21:00"],
      wed: ["06:00-21:00"],
      thu: ["06:00-21:00"],
      fri: ["06:00-21:00"],
      sat: ["06:00-21:00"],
      sun: ["08:00-16:00"],
      hol: ["08:00-16:00"],
      display,
    });
  });

  it("parses 'Lun-Dom HH:MM-HH:MM' with no festivos (ACBSD)", () => {
    const display = "Lun-Dom 06:30-20:00";
    const result = parseSchedule(display);
    expect(result.mon).toEqual(["06:30-20:00"]);
    expect(result.sun).toEqual(["06:30-20:00"]);
    expect("hol" in result).toBe(false);
  });
});
