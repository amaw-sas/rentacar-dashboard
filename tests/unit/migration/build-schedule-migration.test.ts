import { describe, it, expect } from "vitest";
import {
  buildScheduleMigration,
  sqlLiteral,
  type DumpRow,
} from "@/scripts/migration/build-schedule-migration";

const ROWS: DumpRow[] = [
  { code: "ACBOJ", name: "Bogotá Calle 170", schedule: { display: "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00" } },
  { code: "AABOT", name: "Bogotá Aeropuerto", schedule: { display: "Lun-Dom 24 horas | Festivos 06:00-21:00" } },
  { code: "AAMDL", name: "Medellín Aeropuerto", schedule: {} }, // empty → no change
  { code: "ACMDL", name: "Medellín Poblado", schedule: null }, // literal null
];

describe("buildScheduleMigration (issue #96 runner)", () => {
  // SCEN-009: deterministic, byte-identical across runs over the same dump.
  it("produces byte-identical artifacts on repeated runs", () => {
    const a = buildScheduleMigration(ROWS);
    const b = buildScheduleMigration(ROWS);
    expect(a.sql).toBe(b.sql);
    expect(a.review).toBe(b.review);
  });

  // SCEN-009: every emitted UPDATE carries the idempotency guard.
  it("guards every UPDATE with IS DISTINCT FROM", () => {
    const { sql } = buildScheduleMigration(ROWS);
    const updates = sql.split("\n").filter((l) => l.startsWith("UPDATE locations"));
    expect(updates.length).toBeGreaterThan(0);
    for (const line of updates) {
      expect(line).toContain("schedule IS DISTINCT FROM");
      expect(line).toMatch(/WHERE code = '[A-Z]+'/);
    }
  });

  it("emits no UPDATE for an already-empty {} row", () => {
    const { sql } = buildScheduleMigration([ROWS[2]]);
    expect(sql).not.toContain("UPDATE locations");
  });

  it("emits an UPDATE that sets the structured form for a display row", () => {
    const { sql, changedCount } = buildScheduleMigration([ROWS[0]]);
    expect(changedCount).toBe(1);
    expect(sql).toContain("\"mon\":[\"08:00-16:00\"]");
    expect(sql).toContain("\"sat\":[\"08:00-13:00\"]");
    // festivos not mentioned → no hol key in the emitted json
    expect(sql).not.toContain("\"hol\"");
  });

  it("lists all rows in the review report and flags attention rows", () => {
    const { review } = buildScheduleMigration(ROWS);
    for (const row of ROWS) expect(review).toContain(row.code);
    // AAMDL/ACMDL end up empty → attention; ACBOJ has hol absent → attention
    expect(review).toContain("quedó `{}`");
    expect(review).toContain("`hol` ausente");
  });

  // SCEN-012: operator corrections merged on top of the faithful parse.
  it("merges an override onto the parsed result (adds/replaces day keys)", () => {
    const rows: DumpRow[] = [
      { code: "ACBOJ", name: "Bogotá Calle 170", schedule: { display: "Lun-Vie 08:00-16:00 | Sáb 08:00-13:00" } },
    ];
    const overrides = { ACBOJ: { sun: ["08:00-13:00"], hol: ["08:00-13:00"] } };
    const { sql, review } = buildScheduleMigration(rows, overrides);
    expect(sql).toContain("\"sun\":[\"08:00-13:00\"]");
    expect(sql).toContain("\"hol\":[\"08:00-13:00\"]");
    // parse-only keys survive (mon from the display)
    expect(sql).toContain("\"mon\":[\"08:00-16:00\"]");
    // display preserved (literal in the SQL jsonb — pipe not escaped here)
    expect(sql).toContain("\"display\":\"Lun-Vie 08:00-16:00 | Sáb 08:00-13:00\"");
    // report flags the corrected row
    expect(review).toContain("corregida");
  });

  it("rejects an override that produces a schema-invalid result", () => {
    const rows: DumpRow[] = [
      { code: "X", name: "X", schedule: { display: "Lun-Vie 08:00-16:00" } },
    ];
    // 08:15 is off the 30-min grid → locationScheduleSchema must reject.
    expect(() => buildScheduleMigration(rows, { X: { hol: ["08:15-13:00"] } })).toThrow();
  });

  it("doubles single quotes when building a SQL literal", () => {
    expect(sqlLiteral("O'Higgins")).toBe("'O''Higgins'");
    expect(sqlLiteral("plain")).toBe("'plain'");
    expect(sqlLiteral("a'b'c")).toBe("'a''b''c'");
  });
});
