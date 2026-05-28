-- Issue #20 — legacy reservations ETL marker + idempotency key.
--
-- Filename version 20260528155116 is synthetic, chosen to sort strictly AFTER
-- migration 049 (...337). When this is applied to a branch/prod via MCP
-- apply_migration, rename the file to the server-recorded
-- supabase_migrations.schema_migrations version so `supabase db push` treats it
-- as already applied (repo convention, issue #63 lesson). See migration 051
-- (sorts strictly after, version ...117).
--
-- Adds TWO temporary columns to public.reservations for the ETL
-- (scripts/migration/etl-reservations.py):
--
--   * _legacy_id      — the legacy reservations.id (bigint PK). This is the
--     IDEMPOTENCY KEY. Unlike customers (#19), reservations has no natural
--     unique column (reservation_code is nullable and not unique), so the ETL
--     inserts with ON CONFLICT (_legacy_id) DO NOTHING. The UNIQUE index below
--     is on a NULLABLE column: Postgres treats NULLs as distinct, so any number
--     of dashboard-created rows (NULL _legacy_id) coexist freely, while no two
--     ETL rows can share a legacy id (a re-run inserts zero).
--
--   * _legacy_migrated_at — run-start timestamp stamped on every ETL-inserted
--     row; NULL for dashboard-created rows. Used for scoped rollback
--     (docs/data-ops/.../rollback.sql deletes ONLY rows WHERE
--     _legacy_migrated_at IS NOT NULL) so a dashboard reservation created during
--     the migration window is never touched.
--
-- Neither column is part of the application data model. Both are dropped by
-- migration 051 after #20 validation sign-off (or on rollback). Idempotent:
-- safe to re-apply (add column / create index if not exists).
--
-- Prod-safety: ADD COLUMN here is metadata-only (both columns nullable, no
-- default → no table rewrite on PG 11+). The unique index is built NON-
-- concurrently on purpose: the column is all-NULL at creation so the build is
-- near-instant, and CONCURRENTLY cannot run inside the migration's transaction
-- wrapper. lock_timeout caps how long this waits behind a live dashboard writer
-- so it fails fast rather than blocking reservation writes indefinitely.

set local lock_timeout = '3s';

alter table public.reservations
  add column if not exists _legacy_id bigint,
  add column if not exists _legacy_migrated_at timestamptz;

create unique index if not exists reservations_legacy_id_key
  on public.reservations(_legacy_id);

comment on column public.reservations._legacy_id is
  'TEMPORARY (issue #20): legacy reservations.id (bigint). Idempotency key for '
  'the ETL — insert uses ON CONFLICT (_legacy_id) DO NOTHING. UNIQUE index allows '
  'multiple NULLs (dashboard-created rows). Dropped by migration 051.';

comment on column public.reservations._legacy_migrated_at is
  'TEMPORARY (issue #20): timestamp stamped by the legacy-reservations ETL on '
  'every row it inserts; NULL for dashboard-created rows. Used for scoped '
  'rollback. Dropped by migration 051 after migration sign-off.';
