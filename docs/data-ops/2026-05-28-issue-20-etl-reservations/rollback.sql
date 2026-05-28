-- Rollback for the legacy reservations ETL (issue #20).
-- Deletes ONLY rows the ETL inserted — every such row carries
-- _legacy_migrated_at IS NOT NULL (migration 050). Dashboard-created
-- reservations keep that column NULL and are never touched. Run ONLY if the ETL
-- run must be undone (failed validation, or after sign-off as part of
-- decommissioning).
--
-- FK SAFETY — two dependents reference public.reservations(id), with DIFFERENT
-- delete semantics (verified against migrations):
--
--   * public.commissions.reservation_id  -> NO ACTION (011_commissions.sql:3,
--     no `on delete` clause). A bare DELETE would ABORT with SQLSTATE 23503 the
--     moment any ETL-inserted reservation has a matched commission. Commissions
--     are FINANCIAL records — this rollback must NEVER silently delete them. The
--     DO block below ABORTS the whole transaction with a clear message if any
--     such dependent exists, so the operator consciously resolves it first
--     (reassign/remove the commission) rather than the outcome depending on FK
--     accident. (A freshly-migrated reservation normally has no commission yet —
--     commissions come from the separate Excel-import flow — so this guard is
--     expected to pass, but it fails LOUDLY if not.)
--
--   * public.notification_logs.reservation_id -> ON DELETE CASCADE
--     (020_notification_logs.sql:3). Logs belonging to a rolled-back reservation
--     are operational, not business state, and are removed automatically by the
--     cascade. No guard needed; this is intentional. (ETL rows are inserted with
--     notification_sent=false and the ETL sends nothing, so in practice an
--     ETL-inserted reservation has no notification_logs.)
--
-- Verification of the delete scope (run inside the transaction, before COMMIT):
--   SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL;
--   -- This is exactly N, the number the ETL run reported as `inserted`.
--   -- The DELETE below must report the same N.

BEGIN;

-- Executable FK guard: abort if any commission references an ETL-inserted
-- reservation. RAISE EXCEPTION inside the transaction rolls everything back, so
-- nothing is deleted until the operator resolves the financial dependents.
DO $$
DECLARE
  dependent_count integer;
BEGIN
  SELECT count(*) INTO dependent_count
  FROM public.commissions cm
  JOIN public.reservations r ON cm.reservation_id = r.id
  WHERE r._legacy_migrated_at IS NOT NULL;

  IF dependent_count > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: % commission(s) reference ETL-inserted reservations. '
      'Reassign or remove those commissions before running this rollback '
      '(commissions are NO ACTION FKs and are financial records — never '
      'auto-deleted here).',
      dependent_count;
  END IF;
END $$;

-- notification_logs.reservation_id is ON DELETE CASCADE: any log rows attached
-- to the deleted reservations are removed automatically (operational, not
-- business state). No separate statement needed.
DELETE FROM public.reservations
WHERE _legacy_migrated_at IS NOT NULL;

-- Expected: N rows deleted (== the ETL run's `inserted`). After this,
--   SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL;
-- must return 0, and the total count returns to the pre-ETL baseline R0.
-- Verify the deleted count BEFORE COMMIT.
COMMIT;
