import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SEARCH_COLUMNS } from "@/lib/reservations/list-params";

/**
 * Scenarios for issue #102 — trigram (pg_trgm GIN) indexes for the
 * reservations-list search.
 *
 * The migration's executable contract is verified statically here (no live DB):
 *  - pg_trgm is enabled, and one GIN index with gin_trgm_ops exists for EXACTLY
 *    the columns the search runs over (SEARCH_COLUMNS) — no missing column
 *    (a searched column left unindexed still Seq-Scans) and no stray index on a
 *    non-searched column. This is the drift guard: changing SEARCH_COLUMNS in
 *    list-params.ts without updating this migration fails the suite.
 *  - The build is NON-concurrent — CREATE INDEX CONCURRENTLY cannot run inside
 *    apply_migration's transaction wrapper (same constraint as migration 050),
 *    so its presence here would make the migration unappliable.
 *
 * The migration is located by its stable `_059_...trgm` suffix rather than its
 * full timestamp, because the timestamp prefix may be renamed to the
 * server-recorded schema_migrations version on apply (issue #63 convention).
 */
const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  /_059_reservations_search_trgm_indexes\.sql$/.test(f),
);

const SQL = MIGRATION_FILE
  ? readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), "utf8")
  : "";

// Executable lines only — strip `--` comments so assertions never match the
// rationale prose (e.g. the comment that mentions CONCURRENTLY).
const EXECUTABLE = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration 059 — reservations search trigram indexes", () => {
  it("the migration file exists", () => {
    expect(MIGRATION_FILE).toBeDefined();
  });

  it("enables the pg_trgm extension idempotently", () => {
    expect(EXECUTABLE).toMatch(
      /create\s+extension\s+if\s+not\s+exists\s+pg_trgm/i,
    );
  });

  it("creates a GIN trigram index for every searched column", () => {
    for (const col of SEARCH_COLUMNS) {
      const re = new RegExp(
        `create\\s+index\\s+if\\s+not\\s+exists[\\s\\S]*?using\\s+gin\\s*\\(\\s*${col}\\s+(?:extensions\\.)?gin_trgm_ops\\s*\\)`,
        "i",
      );
      expect(EXECUTABLE, `missing GIN trigram index for ${col}`).toMatch(re);
    }
  });

  it("creates exactly one trigram index per searched column (no extras)", () => {
    const trgmIndexes = EXECUTABLE.match(/gin_trgm_ops/gi) ?? [];
    expect(trgmIndexes.length).toBe(SEARCH_COLUMNS.length);
  });

  it("builds NON-concurrently (CONCURRENTLY breaks the txn-wrapped apply)", () => {
    expect(EXECUTABLE).not.toMatch(/concurrently/i);
  });

  it("caps build blocking with a lock_timeout", () => {
    expect(EXECUTABLE).toMatch(/set\s+local\s+lock_timeout/i);
  });
});
