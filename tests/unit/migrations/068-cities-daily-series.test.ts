import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static contract for migration 068 — the cities_daily_series RPC backing the
 * Ciudades momentum lists (En alza / En baja). Verified without a live DB.
 *
 *  - (p_franchises text[], p_days int) signature returning
 *    day/city_id/city_name/created_count/used_count.
 *  - created bucketed in America/Bogota, used by pickup_date + status='utilizado'
 *    (reconciles with the other cities RPCs).
 *  - security invoker + pinned search_path.
 *
 * Located by its stable `_068_...` suffix, not the full timestamp (issue #63).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_068_cities_daily_series_rpc\.sql$/.test(f)
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 068 — cities_daily_series RPC", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("declares the function with the (p_franchises, p_days) signature", () => {
    expect(EXECUTABLE).toMatch(
      /create or replace function public\.cities_daily_series/
    );
    expect(EXECUTABLE).toMatch(/p_franchises\s+text\[\]/);
    expect(EXECUTABLE).toMatch(/p_days\s+int/);
  });

  it("returns the day/city/count columns", () => {
    for (const col of ["day", "city_id", "city_name", "created_count", "used_count"]) {
      expect(EXECUTABLE, col).toContain(col);
    }
  });

  it("buckets created in America/Bogota and used by pickup_date + utilizado", () => {
    expect(EXECUTABLE).toMatch(/created_at at time zone 'America\/Bogota'/);
    expect(EXECUTABLE).toMatch(/status = 'utilizado'/);
  });

  it("is security invoker with a pinned search_path", () => {
    expect(EXECUTABLE).toMatch(/security invoker/);
    expect(EXECUTABLE).toMatch(/set search_path = ''/);
  });
});
