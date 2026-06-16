import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static contract for migration 061 — the reservation_daily_series RPC backing
 * the dashboard trend charts. Verified without a live DB (mirrors the 059 test):
 *
 *  - The function exists with the (p_from date, p_to date, p_franchises text[])
 *    signature and returns the day/franchise/created_count/used_count table the
 *    query wrapper and charts depend on.
 *  - created_count buckets created_at in America/Bogota (so it reconciles with
 *    getReservationCounts), used_count uses pickup_date + status='utilizado'
 *    (recogida-based, like getUsedThisMonth) — drift in either breaks the
 *    card/chart reconciliation, so both are pinned here.
 *  - It is security invoker with a pinned search_path (same safety stance as the
 *    attribution_breakdown RPC in #113).
 *
 * Located by its stable `_061_...` suffix, not the full timestamp, because the
 * prefix may be renamed to the server-recorded version on apply (issue #63).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_061_reservation_daily_series_rpc\.sql$/.test(f)
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

// Executable lines only — strip `--` comments so assertions never match prose.
const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 061 — reservation_daily_series RPC", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("declares the function with the expected name and parameters", () => {
    expect(EXECUTABLE).toMatch(
      /create\s+or\s+replace\s+function\s+public\.reservation_daily_series/i
    );
    expect(EXECUTABLE).toMatch(/p_from\s+date/i);
    expect(EXECUTABLE).toMatch(/p_to\s+date/i);
    expect(EXECUTABLE).toMatch(/p_franchises\s+text\[\]/i);
  });

  it("returns the day/franchise/created_count/used_count table", () => {
    expect(EXECUTABLE).toMatch(/returns\s+table\s*\(/i);
    expect(EXECUTABLE).toMatch(/created_count\s+int/i);
    expect(EXECUTABLE).toMatch(/used_count\s+int/i);
  });

  it("buckets created_count in America/Bogota (reconciles with the cards)", () => {
    expect(EXECUTABLE).toMatch(
      /created_at\s+at\s+time\s+zone\s+'America\/Bogota'/i
    );
  });

  it("buckets used_count by pickup_date + status='utilizado' (recogida-based)", () => {
    expect(EXECUTABLE).toMatch(/status\s*=\s*'utilizado'/i);
    expect(EXECUTABLE).toMatch(/pickup_date\s+between/i);
  });

  it("emits a zero-filled grid (generate_series × franchises, coalesce 0)", () => {
    expect(EXECUTABLE).toMatch(/generate_series\s*\(/i);
    expect(EXECUTABLE).toMatch(/unnest\s*\(\s*p_franchises\s*\)/i);
    expect(EXECUTABLE).toMatch(/coalesce\s*\(/i);
  });

  it("is security invoker with a pinned search_path", () => {
    expect(EXECUTABLE).toMatch(/security\s+invoker/i);
    expect(EXECUTABLE).toMatch(/set\s+search_path\s*=\s*''/i);
  });
});
