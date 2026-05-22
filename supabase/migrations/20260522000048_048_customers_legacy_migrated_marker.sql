-- Issue #19 — legacy customers ETL marker column.
--
-- Adds a TEMPORARY provenance marker to public.customers. The ETL
-- (scripts/migration/etl-customers.py) stamps every row it inserts with a
-- single run-start timestamp; rows created by the dashboard keep it NULL.
--
-- Purpose:
--   * idempotency  — a re-run can classify a conflicting identification_number
--     as already_migrated (marker NOT NULL) vs conflict_existing (marker NULL,
--     dashboard-owned, never overwrite).
--   * rollback     — docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql
--     deletes ONLY rows WHERE _legacy_migrated_at IS NOT NULL, so a dashboard
--     customer created during the migration window is never touched.
--
-- This column is NOT part of the application data model. It is dropped by
-- migration 049 after #19 validation sign-off (or on rollback). Idempotent:
-- safe to re-apply (add column if not exists).

alter table public.customers
  add column if not exists _legacy_migrated_at timestamptz;

comment on column public.customers._legacy_migrated_at is
  'TEMPORARY (issue #19): timestamp stamped by the legacy-customers ETL on every '
  'row it inserts; NULL for dashboard-created rows. Used for idempotency and '
  'scoped rollback. Dropped by migration 049 after migration sign-off.';
