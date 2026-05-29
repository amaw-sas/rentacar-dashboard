# ETL run summary — legacy reservations (issue #20)

No-PII aggregate evidence of `etl-reservations.py` runs. Transcribe the script's
stdout summary object here (the per-row JSONL report stays gitignored). No
identification number / name / email is pasted here; this file is committed.

> **STATUS: DRY-RUN COMPLETE (2026-05-29).** Full extract+insert ran against the
> disposable branch `cwxdnfixnoqkgrvrbssu` — see the run below and the gap report
> at `docs/migration-runs/dry-run-2026-05-29.md`. The **production run (#23)** is
> still pending. Operational note: connect via the **transaction pooler (port
> 6543)** — the session pooler (5432) rejected auth intermittently; the ETL is one
> transaction with no session state, so 6543 is fully compatible.

---

## Run: 2026-05-29T15:21Z — DRY-RUN + COMMIT (`cwxdnfixnoqkgrvrbssu`)

| Field | Value |
|---|---|
| Mode | `commit` (preceded by `--dry-run`, identical figures) |
| Committed | `true` |
| Exit code | 0 |
| Destination (masked) | `postgresql://***@aws-1-us-east-1.pooler.supabase.com:6543/postgres` |
| Elapsed (s) | 1.7 (dry-run) / 1.7 (commit) |
| Legacy rows total | 12967 |
| Inserted | 12445 (95.97 %) |
| Skipped — already_migrated | 0 (first run) / 12445 (idempotent re-run) |
| Rejected — customer_not_migrated | 121 (matches the 121 placeholder cascade exactly) |
| Rejected — pickup_location_null | 354 |
| Rejected — return_location_null | 47 |
| Rejected — *_location_unmapped | 0 |
| Rejected — category_unmapped | 0 |
| Rejected — franchise_unmapped | 0 |
| Rejected — status_unmapped | 0 |
| Rejected — numeric_overflow | 0 |
| Reconciliation reconciles? (`inserted + skipped + rejected == 12967`) | yes (12445 + 0 + 522) |

## Acceptance (NOT a hardcoded count)

- Reconciliation closes at the row level.
- Every reject carries a logged taxonomy reason.
- 0 constraint violations.
- Expected inserted band **~12,150–12,271** (12,967 − location NULLs ∪ ~121
  placeholder-customer cascade rejects; exact overlap pinned by the dry-run).
  The audit's `≥12,212` is informational, not a gate.
- **Dry-run result: 12,445 inserted (95.97 %)** — above the conservative band
  because actual location-NULLs (401) came in lower than the estimate. The four
  acceptance criteria above all hold; the count is a consequence of legacy data
  quality, not a target. This also clears the issue body's stale `≥95 %`.

## Idempotent re-run

Run the ETL a second time, unchanged → `inserted=0`,
`skipped.already_migrated == <first-run inserted>`, no duplicate `_legacy_id`,
`committed=true`, `reconciles=true`.

## Post-run verification (SQL — actual results, 2026-05-29)

```sql
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL;  -- 12445 (== inserted)
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NULL;      -- 0 (clean branch baseline)
SELECT count(*), count(DISTINCT _legacy_id) FROM public.reservations WHERE _legacy_id IS NOT NULL;  -- 12445, 12445 (no dups)
SELECT count(*) FROM public.reservations WHERE _legacy_migrated_at IS NOT NULL
  AND booking_type NOT IN ('standard','standard_with_insurance','monthly');      -- 0
```

Also verified: 0 orphan customer FKs, 0 reservations inserted with a null location
(the 401 location-NULL rows were rejected, not inserted), customers 10,774/10,774
marked. Domain distributions (sum 12,445): booking_type standard 11,130 /
standard_with_insurance 1,192 / monthly 123; franchise alquilame 7,227 /
alquicarros 2,624 / alquilatucarro 2,594.

## Marker lifecycle

Migration 050 adds `_legacy_id` (UNIQUE) + `_legacy_migrated_at`; the paired drop
migration (051) is deferred until #20 validation sign-off (#24 cleanup), so
`rollback.sql` stays usable. Keep this file updated as the runs happen.
