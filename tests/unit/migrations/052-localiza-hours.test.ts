import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locationSchema } from "@/lib/schemas/location";

/**
 * Scenarios for the Localiza extended-hours change (effective 2026-06-02).
 * Source: official Localiza communiqué. schedule.display is the informational
 * text rendered on the public site; these strings are the observable contract.
 *
 * Both the forward migration (052) and seed.sql must declare the exact new
 * display string for each of the three affected branches, and each string must
 * satisfy locationSchema's `schedule` shape. The literal SQL embeds the JSON
 * with a space after the colon: {"display": "..."}.
 */
const EXPECTED: Record<string, string> = {
  AASMR: "Todos los días 07:00-21:00",
  ACKAL: "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest Cerrado",
  ACKJC: "Lun-Vie 08:00-17:00 | Sáb 08:00-14:00 | Dom y fest 08:00-14:00",
};

const sqlLiteral = (display: string) => `{"display": "${display}"}`;

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20260601160446_052_update_localiza_branch_hours_jun2026.sql"),
  "utf8",
);
const SEED = readFileSync(
  resolve(__dirname, "../../../supabase/seed.sql"),
  "utf8",
);

describe("Localiza branch hours — Jun 2026 extension", () => {
  for (const [code, display] of Object.entries(EXPECTED)) {
    const literal = sqlLiteral(display);

    it(`migration 052 sets ${code} to the new schedule`, () => {
      expect(MIGRATION).toContain(literal);
      expect(MIGRATION).toContain(`WHERE code = '${code}'`);
    });

    it(`seed.sql declares ${code} with the new schedule`, () => {
      expect(SEED).toContain(`'${code}'`);
      expect(SEED).toContain(literal);
    });

    it(`${code} new schedule is valid against locationSchema.schedule`, () => {
      const parsed = locationSchema.shape.schedule.safeParse({ display });
      expect(parsed.success).toBe(true);
    });
  }

  it("migration keeps stale display strings only inside comments, never in an UPDATE", () => {
    for (const stale of [
      "Todos los días 07:00-18:00",
      "Lun-Sáb 08:00-16:00 | Dom y fest Cerrado",
      "Lun-Sáb 08:00-16:00 | Dom y fest 08:00-13:00",
    ]) {
      const inExecutable = MIGRATION.split("\n").some(
        (line) => !line.trimStart().startsWith("--") && line.includes(stale),
      );
      expect(inExecutable).toBe(false);
    }
  });
});
