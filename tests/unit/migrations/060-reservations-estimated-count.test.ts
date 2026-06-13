import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Scenarios for issue #105 — growth-gated count strategy for the reservations
 * list. getReservationsPage() reads this RPC's planner estimate to choose
 * between count:exact (< 100k rows) and count:planned (>= 100k).
 *
 * The migration's executable contract is verified statically here (no live DB):
 *  - the RPC exists and returns reltuples (a planner statistic, not a COUNT(*))
 *    from pg_class for public.reservations — the whole point is that probing the
 *    size never costs a scan;
 *  - it is SECURITY INVOKER with search_path pinned (least privilege; pg_class is
 *    world-readable so no DEFINER escalation), and EXECUTE is granted to
 *    authenticated so the dashboard role can call it.
 *
 * Located by its stable `_060_...estimated_count` suffix rather than the full
 * timestamp, which may be renamed to the server-recorded schema_migrations
 * version on apply (issue #63 convention).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_060_reservations_estimated_count_rpc\.sql$/.test(f),
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

// Executable lines only — strip `--` comments so assertions never match prose.
const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 060 — reservations estimated count rpc", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("defines the reservations_estimated_count function", () => {
    expect(EXECUTABLE).toMatch(
      /create\s+or\s+replace\s+function\s+public\.reservations_estimated_count\s*\(\s*\)/i,
    );
  });

  it("returns reltuples from pg_class — a planner estimate, never a COUNT(*)", () => {
    expect(EXECUTABLE).toMatch(/reltuples/i);
    expect(EXECUTABLE).toMatch(/pg_catalog\.pg_class/i);
    expect(EXECUTABLE).toMatch(/'public\.reservations'::regclass/i);
    // It must not smuggle in a real COUNT(*) scan — that would defeat the
    // optimization. (The function name legitimately ends in "_count".)
    expect(EXECUTABLE).not.toMatch(/count\s*\(\s*\*\s*\)/i);
  });

  it("clamps the never-analyzed sentinel: reltuples = -1 must not return a negative", () => {
    // Postgres stores reltuples = -1 for a table that has never been analyzed.
    // greatest(reltuples, 0) folds it to 0 so the gate sees a safe (sub-threshold)
    // value instead of a negative one.
    expect(EXECUTABLE).toMatch(/greatest\s*\(\s*reltuples\s*,\s*0\s*\)/i);
  });

  it("is security invoker with a pinned search_path (least privilege)", () => {
    expect(EXECUTABLE).toMatch(/security\s+invoker/i);
    expect(EXECUTABLE).toMatch(/set\s+search_path\s*=\s*''/i);
  });

  it("grants execute to the authenticated role", () => {
    expect(EXECUTABLE).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.reservations_estimated_count\s*\(\s*\)\s+to\s+authenticated/i,
    );
  });
});
