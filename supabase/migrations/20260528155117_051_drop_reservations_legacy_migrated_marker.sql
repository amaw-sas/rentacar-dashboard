-- Issue #20 — drop the TEMPORARY legacy reservations ETL marker + idempotency key.
--
-- NOT YET APPLIED (deferred, same policy as #19 migration 049): the marker stays
-- so rollback.sql remains usable until #20 validation sign-off. Filename version
-- 20260528155117 is synthetic, chosen to sort STRICTLY AFTER 050 (...116) so a
-- `supabase db push` can never place the drop before the add. When this IS
-- applied via MCP, rename the file to the server-recorded schema_migrations
-- version (repo convention).
--
-- APPLY ONLY after #20 validation sign-off (the prod ETL run is verified and
-- accepted, issue #24 cleanup) OR as part of a rollback once the ETL-inserted
-- rows have been removed via
-- docs/data-ops/2026-05-XX-issue-20-etl-reservations/rollback.sql.
--
-- Do NOT apply while the marker is still needed: dropping _legacy_migrated_at
-- makes the scoped rollback (DELETE WHERE _legacy_migrated_at IS NOT NULL)
-- impossible, and dropping _legacy_id removes the idempotency guard.
--
-- Idempotent: safe to re-apply (drop index / column if exists).

drop index if exists public.reservations_legacy_id_key;

alter table public.reservations
  drop column if exists _legacy_id,
  drop column if exists _legacy_migrated_at;
