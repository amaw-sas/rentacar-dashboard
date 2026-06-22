import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static contract for migration 066 — the cities_rental_period_counts RPC
 * backing the Analytics → Ciudades report. Verified without a live DB (mirrors
 * the 061 test):
 *
 *  - Exists with the (p_franchises text[]) signature and returns the
 *    city/franchise + eight metric×period count columns the query wrapper and
 *    report depend on.
 *  - created_* buckets created_at in America/Bogota and used_* uses pickup_date
 *    + status='utilizado', so the numbers reconcile with the dashboard cards.
 *  - Week boundary is Monday (date_trunc('week')), matching bogotaStartOfWeekYMD.
 *  - security invoker with a pinned search_path (same stance as #061 / #113).
 *
 * Located by its stable `_066_...` suffix, not the full timestamp (issue #63).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_066_cities_rental_period_counts_rpc\.sql$/.test(f)
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

// Executable lines only — strip `--` comments so assertions never match prose.
const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 066 — cities_rental_period_counts RPC", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("declares the function with the p_franchises signature", () => {
    expect(EXECUTABLE).toMatch(
      /create or replace function public\.cities_rental_period_counts/
    );
    expect(EXECUTABLE).toMatch(/p_franchises\s+text\[\]/);
  });

  it("returns the eight metric×period count columns", () => {
    for (const col of [
      "created_today",
      "created_yesterday",
      "created_week",
      "created_month",
      "used_today",
      "used_yesterday",
      "used_week",
      "used_month",
    ]) {
      expect(EXECUTABLE, col).toContain(col);
    }
  });

  it("buckets created in America/Bogota and used by pickup_date + utilizado", () => {
    expect(EXECUTABLE).toMatch(/created_at at time zone 'America\/Bogota'/);
    expect(EXECUTABLE).toMatch(/status = 'utilizado'/);
  });

  it("anchors the week to Monday via date_trunc('week')", () => {
    expect(EXECUTABLE).toMatch(/date_trunc\('week'/);
    expect(EXECUTABLE).toMatch(/date_trunc\('month'/);
  });

  it("joins the pickup-location → city chain", () => {
    expect(EXECUTABLE).toMatch(/join public\.locations l on l\.id = r\.pickup_location_id/);
    expect(EXECUTABLE).toMatch(/left join public\.cities c on c\.id = l\.city_id/);
  });

  it("is security invoker with a pinned search_path", () => {
    expect(EXECUTABLE).toMatch(/security invoker/);
    expect(EXECUTABLE).toMatch(/set search_path = ''/);
  });
});
