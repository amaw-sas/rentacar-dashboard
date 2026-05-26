-- Issue #19 — drop the TEMPORARY legacy customers ETL marker column.
--
-- NOT YET APPLIED to prod (deferred per the issue #63 decision, 2026-05-25: the
-- marker stays so rollback.sql remains usable). Filename version 20260525201337
-- is synthetic, chosen to sort STRICTLY AFTER 048 (...336) so a `supabase db push`
-- can never place the drop before the add. When this IS applied via MCP, rename
-- the file to the server-recorded schema_migrations version (repo convention).
--
-- APPLY ONLY after #19 validation sign-off (the prod ETL run is verified and
-- accepted) OR as part of a rollback once the ETL-inserted rows have been
-- removed via docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql.
--
-- Do NOT apply while the marker is still needed: dropping it makes the scoped
-- rollback (DELETE WHERE _legacy_migrated_at IS NOT NULL) impossible, because
-- ETL rows can no longer be distinguished from dashboard-created rows.
--
-- Idempotent: safe to re-apply (drop column if exists).

alter table public.customers
  drop column if exists _legacy_migrated_at;
