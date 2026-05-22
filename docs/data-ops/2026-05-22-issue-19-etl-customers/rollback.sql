-- Rollback for the legacy customers ETL (issue #19).
-- Deletes ONLY rows the ETL inserted — every such row carries
-- _legacy_migrated_at IS NOT NULL (migration 048). Dashboard-created customers
-- keep that column NULL and are never touched. Run ONLY if the ETL run must be
-- undone (failed validation, or after sign-off as part of decommissioning).
--
-- FK SAFETY (now an EXECUTABLE guard, not just advice):
--   Issue #19 is customers-only — it inserts rows into public.customers and
--   nothing else. The only FK referencing public.customers(id) is
--   public.reservations.customer_id (verified against all migrations:
--   008_reservations.sql line 4; no commission/referral FK to customers). If a
--   dependent reservation was attached to an ETL-inserted customer AFTER the
--   migration, deleting that customer would fail on the FK. The DO block below
--   ABORTS the whole transaction with a clear message if any such dependent
--   exists, so the rollback can never partially run or surprise the operator.
--
-- Verification of the delete scope (run inside the transaction, before COMMIT):
--   SELECT count(*) FROM public.customers WHERE _legacy_migrated_at IS NOT NULL;
--   -- This is exactly N, the number the ETL run reported as `inserted`.
--   -- The DELETE below must report the same N.

BEGIN;

-- Executable FK guard: abort if any reservation references an ETL-inserted
-- customer. RAISE EXCEPTION inside the transaction rolls everything back, so
-- nothing is deleted until the operator resolves the dependents.
DO $$
DECLARE
  dependent_count integer;
BEGIN
  SELECT count(*) INTO dependent_count
  FROM public.reservations r
  JOIN public.customers c ON r.customer_id = c.id
  WHERE c._legacy_migrated_at IS NOT NULL;

  IF dependent_count > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: % reservation(s) reference ETL-inserted customers. '
      'Reassign or remove those reservations before running this rollback.',
      dependent_count;
  END IF;
END $$;

DELETE FROM public.customers
WHERE _legacy_migrated_at IS NOT NULL;

-- Expected: N rows deleted (== the ETL run's `inserted`). After this,
--   SELECT count(*) FROM public.customers WHERE _legacy_migrated_at IS NOT NULL;
-- must return 0, and the total count returns to the pre-ETL baseline C0.
-- Verify the deleted count BEFORE COMMIT.
COMMIT;
