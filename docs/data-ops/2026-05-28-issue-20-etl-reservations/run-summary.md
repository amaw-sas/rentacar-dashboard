# ETL run summary — legacy reservations (issue #20)

No-PII aggregate evidence of `etl-reservations.py` runs. Transcribe the script's
stdout summary object here (the per-row JSONL report stays gitignored). No
identification number / name / email is pasted here; this file is committed.

> **STATUS: PENDING RUN.** The script + migration 050 + rollback are implemented
> and unit-verified (103 tests, fake-cursor SCEN-001/007, branch-verified
> SCEN-008/009). The real extract+insert against the 12,967-row legacy dump has
> NOT run — it requires the legacy MariaDB, which lives with the migration
> operator. Fill the tables below from:
>   1. the **dry-run (#22)** against a disposable Supabase branch, then
>   2. the **production run (#23)**.

---

## Run: <UTC timestamp> — <DRY-RUN | PRODUCTION> (`<project_ref>`)

| Field | Value |
|---|---|
| Mode | `dry-run` / `commit` |
| Committed | `true` / `false` |
| Exit code | |
| Destination (masked) | `postgresql://***@.../...` |
| Elapsed (s) | |
| Legacy rows total | 12967 |
| Inserted | |
| Skipped — already_migrated | |
| Rejected — customer_not_migrated | (expected ≈121 placeholder cascade) |
| Rejected — pickup_location_null | (expected ≤355) |
| Rejected — return_location_null | (expected ≤341) |
| Rejected — *_location_unmapped | (expected 0 — S2 holds) |
| Rejected — category_unmapped | (expected 0 — #17, all 17 codes resolve) |
| Rejected — franchise_unmapped | (expected 0 — 3 franchises 1:1) |
| Rejected — status_unmapped | (expected 0 — 0 `Terminado`) |
| Rejected — numeric_overflow | (expected 0) |
| Reconciliation reconciles? (`inserted + skipped + rejected == 12967`) | |

## Acceptance (NOT a hardcoded count)

- Reconciliation closes at the row level.
- Every reject carries a logged taxonomy reason.
- 0 constraint violations.
- Expected inserted band **~12,150–12,271** (12,967 − location NULLs ∪ ~121
  placeholder-customer cascade rejects; exact overlap pinned by the dry-run).
  The audit's `≥12,212` is informational, not a gate.

## Idempotent re-run

Run the ETL a second time, unchanged → `inserted=0`,
`skipped.already_migrated == <first-run inserted>`, no duplicate `_legacy_id`,
`committed=true`, `reconciles=true`.

## Post-run verification (SQL, transcribe results)

```sql
-- inserted rows carry the marker; dashboard rows untouched
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL;  -- == inserted
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NULL;      -- == pre-ETL baseline
-- idempotency key holds, no duplicates
SELECT count(*), count(DISTINCT _legacy_id) FROM public.reservations WHERE _legacy_id IS NOT NULL;  -- equal
-- no guessed FKs / out-of-domain values
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL
  AND booking_type NOT IN ('standard','standard_with_insurance','monthly');      -- 0
```

## Marker lifecycle

Migration 050 adds `_legacy_id` (UNIQUE) + `_legacy_migrated_at`; the paired drop
migration (051) is deferred until #20 validation sign-off (#24 cleanup), so
`rollback.sql` stays usable. Keep this file updated as the runs happen.
