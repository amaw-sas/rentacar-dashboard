-- Post-run verification for the legacy reservations/customers ETL (issue #23).
--
-- Runs AFTER the commit pass against the destination (branch in rehearsal, prod
-- in the window). Asserts INTERNAL CONSISTENCY of the migrated subset only — every
-- check is scoped to `_legacy_migrated_at IS NOT NULL`, so live dashboard-created
-- rows are never counted. No absolute totals are hardcoded: legacy may grow between
-- the dry-run and the window, so this file checks structure, not magic numbers. The
-- inserted-count reconciliation against the dry-run is the ETL's own stdout job.
--
-- Returns one row per check: (ord, check_name, detail, status). status is
-- 'PASS'/'FAIL' for assertions, 'INFO' for distributions. The launcher
-- (run-prod-migration.sh) fails the run if ANY row has status='FAIL'.
--
-- Most assertions are belt-and-suspenders: the UNIQUE index, FK, and CHECK
-- constraints already enforce them at insert time (a violation aborts the ETL
-- commit, exit 7). This file proves the committed result is clean and gives the
-- prod run report its integrity table.

with
mig_res as (
  select * from public.reservations where _legacy_migrated_at is not null
),
checks(ord, check_name, detail, status) as (
  -- 1) No duplicate legacy id among migrated reservations (also enforced by the
  --    UNIQUE index reservations_legacy_id_key; NULLs excluded by construction).
  select 1, 'reservations_no_dup_legacy_id',
    format('rows=%s distinct_legacy_id=%s', count(_legacy_id), count(distinct _legacy_id)),
    case when count(_legacy_id) = count(distinct _legacy_id) then 'PASS' else 'FAIL' end
  from mig_res

  union all
  -- 2) Every migrated reservation carries a non-null _legacy_id (the idempotency key).
  select 2, 'reservations_all_have_legacy_id',
    format('null_legacy_id=%s', count(*) filter (where _legacy_id is null)),
    case when count(*) filter (where _legacy_id is null) = 0 then 'PASS' else 'FAIL' end
  from mig_res

  union all
  -- 3) No migrated reservation has a null pickup/return location (those rows are
  --    rejected by the ETL, never inserted).
  select 3, 'reservations_no_null_location',
    format('null_pickup=%s null_return=%s',
           count(*) filter (where pickup_location_id is null),
           count(*) filter (where return_location_id is null)),
    case when count(*) filter (where pickup_location_id is null or return_location_id is null) = 0
         then 'PASS' else 'FAIL' end
  from mig_res

  union all
  -- 4) No migrated reservation references a non-existent customer (also enforced by FK).
  select 4, 'reservations_no_orphan_customer',
    format('orphans=%s', count(*)),
    case when count(*) = 0 then 'PASS' else 'FAIL' end
  from mig_res r
  left join public.customers c on c.id = r.customer_id
  where r.customer_id is not null and c.id is null

  union all
  -- 5) Distribution: booking_type (domain enforced by CHECK; shown for eyeballing).
  select 5, 'reservations_booking_type_dist',
    string_agg(format('%s=%s', booking_type, n), ' · ' order by booking_type),
    'INFO'
  from (select booking_type, count(*) n from mig_res group by booking_type) d

  union all
  -- 6) Distribution: franchise.
  select 6, 'reservations_franchise_dist',
    string_agg(format('%s=%s', franchise, n), ' · ' order by franchise),
    'INFO'
  from (select franchise, count(*) n from mig_res group by franchise) d

  union all
  -- 7) Distribution: status.
  select 7, 'reservations_status_dist',
    string_agg(format('%s=%s', status, n), ' · ' order by status),
    'INFO'
  from (select status, count(*) n from mig_res group by status) d

  union all
  -- 8) Migrated customers count (info; reconcile against the customers ETL stdout).
  select 8, 'customers_migrated_count',
    format('count=%s', count(*)), 'INFO'
  from public.customers where _legacy_migrated_at is not null

  union all
  -- 9) Migrated reservations count (info; reconcile against the reservations ETL stdout).
  select 9, 'reservations_migrated_count',
    format('count=%s', count(*)), 'INFO'
  from mig_res
)
select check_name, detail, status from checks order by ord;
