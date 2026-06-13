-- Issue #102: trigram (pg_trgm GIN) indexes for the reservations-list search.
--
-- The list search (lib/queries/reservations.ts → searchOrExpr) emits an
-- `or()` of `ILIKE '%term%'` over the SEARCH_COLUMNS defined in
-- lib/reservations/list-params.ts — the five snapshot identity columns plus the
-- operational `nota` (added by issue #109, AFTER #102 was filed; the issue body
-- predates it and lists only five). Every OR branch must be index-backed: a
-- single unindexed branch forces the planner off the bitmap-OR and back to a
-- full Seq Scan, so `nota` is indexed here too. The leading wildcard
-- makes `%term%` NON-indexable by btree, so a zero/low-match search degrades to
-- a Seq Scan + Sort over the whole table to satisfy `ORDER BY ... LIMIT 20`.
-- Measured on prod (13,215 rows): zero-match search = Seq Scan,
-- Rows Removed by Filter: 13215, ~84 ms. Scales linearly with row count.
--
-- A GIN index with the gin_trgm_ops operator class makes `ILIKE '%term%'`
-- index-accelerated (Bitmap Index Scan + BitmapOr), removing the linear scan.
--
-- One GIN index per SEARCH_COLUMN. If SEARCH_COLUMNS changes, this index set
-- must change with it — the behavioral guard is the migration test
-- tests/unit/migrations/059-reservations-search-trgm.test.ts, which asserts an
-- index here for exactly the searched columns (drift fails the suite).
--
-- gin_trgm_ops is schema-qualified (extensions.gin_trgm_ops) so it resolves
-- regardless of the applying role's search_path — pg_trgm installs into the
-- `extensions` schema per the Supabase convention (matches pgcrypto, uuid-ossp).
--
-- NON-concurrent on purpose (same reasoning as migration 050): CREATE INDEX
-- CONCURRENTLY cannot run inside the migration's transaction wrapper, and at
-- 13k rows each GIN build is sub-second. lock_timeout caps how long the build
-- waits behind a live reservation writer so it fails fast rather than blocking
-- writes indefinitely. Revisit CONCURRENTLY (out-of-band) only if these are
-- ever built fresh at 50–100k+ rows, where a blocking build would be felt.
-- Trade-off: GINs add modest write overhead + storage; acceptable here — the
-- reservations table is append-mostly with a low write rate.

set local lock_timeout = '3s';

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_reservations_name_trgm
  on public.reservations using gin (customer_name_at_booking extensions.gin_trgm_ops);

create index if not exists idx_reservations_idnum_trgm
  on public.reservations using gin (customer_identification_number_at_booking extensions.gin_trgm_ops);

create index if not exists idx_reservations_email_trgm
  on public.reservations using gin (customer_email_at_booking extensions.gin_trgm_ops);

create index if not exists idx_reservations_phone_trgm
  on public.reservations using gin (customer_phone_at_booking extensions.gin_trgm_ops);

create index if not exists idx_reservations_code_trgm
  on public.reservations using gin (reservation_code extensions.gin_trgm_ops);

create index if not exists idx_reservations_nota_trgm
  on public.reservations using gin (nota extensions.gin_trgm_ops);
