# ETL run summary — legacy customers (issue #19)

No-PII aggregate evidence of `etl-customers.py` runs. Values are the script's
stdout summary object (the per-row JSONL report stays gitignored — it carries
identification numbers). No identification number is pasted here; this file is
committed.

> The full discarded-identifications list and the cross-type ids live in the
> gitignored JSONL report ONLY (PII). The stdout summary is PII-free (counts).

---

## Run: 2026-05-25T20:26:39Z — PRODUCTION (`ilhdholjrnbycyvejsub`)

| Field | Value |
|---|---|
| Mode | `commit` |
| Committed | `true` |
| Exit code | `0` |
| Destination (masked) | `postgresql://***@aws-1-us-east-1.pooler.supabase.com:5432/postgres` |
| Elapsed (s) | 18.56 |
| Legacy rows total | 12967 |
| Dropped — no identification | 0 |
| Timestamp fallbacks | 0 |
| Placeholders discarded — unique ids | 14 |
| Placeholders discarded — reservations | 121 |
| Within expected range [1, 30]? | `true` |
| Computed unique non-placeholder | 10774 |
| Inserted | 10744 |
| Needs review (one-token names) | 2 |
| Conflicts — by_name / by_email / by_phone | 951 / 204 / 469 |
| Conflicts — cross_type | 17 |
| Skipped — already_migrated | 0 |
| Skipped — conflict_existing | 30 |
| Rejected total (should be 0) | 0 |
| Reconciliation reconciles? | `true` |

30 legacy identifications collided with the 260 pre-existing dashboard customers
→ `ON CONFLICT DO NOTHING` skipped them as `conflict_existing` (not overwritten).
`inserted (10744) + conflict_existing (30) = computed_unique_non_placeholder (10774)`.

### Idempotent re-run (same connstring, immediately after)
`inserted=0`, `skipped.already_migrated=10744`, `skipped.conflict_existing=30`,
`committed=true`, `reconciles=true` — a re-run inserts nothing (SCEN-005).

### Placeholder rule validation
- Rule: **closed enumeration** — `^0+$` + keyboard ramps (prefixes of
  `1234567890`, len ≥ 6) + a verified operator/test denylist. This replaced the
  original provisional `^123\d{4,}$` regex.
- Expectation: 14 unique ids / 121 reservations. Observed: 14 / 121.
  `within_expected_range`: `true`.
- The provisional regex was confirmed WRONG by the dry-run (it discarded ~66 real
  10-digit cédulas starting with 123). The closed rule cannot over-match a real
  cédula; the 14 discarded are all-zeros, keyboard ramps, and verified test ids.

### Gate outcome
- Commit committed 10,744 rows (gate passed: 0 unexpected rejects, placeholders
  within range, every non-inserted record explained as `conflict_existing`).

### Post-run verification (SQL on prod)
- `total=11004` (260 pre-existing + 10744), `marker_not_null=10744`,
  `marker_null=260` (dashboard customers untouched), `identification_number`
  duplicates `=0`, real 123-cédulas present, junk absent, `created_at < 1900` `=0`.
- Marker column `_legacy_migrated_at` kept in place (migration 049 deferred to
  post-validation sign-off) so `rollback.sql` remains available.
