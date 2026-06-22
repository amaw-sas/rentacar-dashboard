import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static contract for migration 067 — extends cities_rental_period_counts with
 * rolling-window periods (last 7 / 14 / 30 days) on top of the calendar periods
 * from #066. Verified without a live DB.
 *
 *  - DROPs first (adding OUT columns changes the return type, which CREATE OR
 *    REPLACE cannot do) then recreates with the rolling columns.
 *  - Rolling windows are inclusive of today: today-6 / today-13 / today-29.
 *  - Keeps the #066 semantics (Bogota-bucketed created, pickup_date+utilizado
 *    used, security invoker, pinned search_path).
 *
 * Located by its stable `_067_...` suffix, not the full timestamp (issue #63).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_067_cities_rental_rolling_windows\.sql$/.test(f)
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 067 — cities_rental rolling windows", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("drops then recreates the function (return type changes)", () => {
    expect(EXECUTABLE).toMatch(
      /drop function if exists public\.cities_rental_period_counts\(text\[\]\)/
    );
    expect(EXECUTABLE).toMatch(
      /create function public\.cities_rental_period_counts/
    );
  });

  it("adds the rolling-window columns for both metrics", () => {
    for (const col of [
      "created_last7",
      "created_last14",
      "created_last30",
      "used_last7",
      "used_last14",
      "used_last30",
    ]) {
      expect(EXECUTABLE, col).toContain(col);
    }
  });

  it("anchors rolling windows inclusive of today (today-6 / -13 / -29)", () => {
    expect(EXECUTABLE).toMatch(/- 6 as last7_start/);
    expect(EXECUTABLE).toMatch(/- 13 as last14_start/);
    expect(EXECUTABLE).toMatch(/- 29 as last30_start/);
  });

  it("keeps the #066 semantics (Bogota created, utilizado used, invoker, search_path)", () => {
    expect(EXECUTABLE).toMatch(/created_at at time zone 'America\/Bogota'/);
    expect(EXECUTABLE).toMatch(/status = 'utilizado'/);
    expect(EXECUTABLE).toMatch(/security invoker/);
    expect(EXECUTABLE).toMatch(/set search_path = ''/);
  });
});
