---
name: etl-customers-hardening
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-22T01:00:00Z
spec: quality-gate findings (edge-case-detector + code-reviewer) + user decisions 2026-05-22
issue: 19
---

# Scenarios — Legacy customers ETL (hardening)

Additional holdout for issue #19, extending `etl-customers.scenarios.md` (SCEN-001..008). These encode behaviors surfaced by the post-implementation quality gate and two user policy decisions (2026-05-22). New scenarios — they do NOT modify the original holdout. Write-once after first commit.

Same target: `scripts/migration/etl-customers.py` + `test_etl_customers.py`.

---

## SCEN-009: identification formatting variants dedup to one customer (normalized key)

**Given**: legacy rows for one person whose `identification` appears in formatting variants — `"12.345.678"`, `"12345678"`, `"12 345 678"` — and a separate passport customer whose identification is `"AB-12345"`.
**When**: the ETL dedups and inserts.
**Then**: the three numeric variants collapse into ONE customer whose persisted `identification_number` is `"12345678"` (spaces, dots, dashes removed); the passport persists as `"AB12345"` (only formatting punctuation removed — alphanumeric content preserved, so passports are never corrupted). Normalization is applied identically to the dedup key AND the persisted value.
**Evidence**: unit test `normalize_identification('12.345.678') == '12345678'`, `normalize_identification('12 345 678') == '12345678'`, `normalize_identification('AB-12345') == 'AB12345'`; `dedup_records` of the three variants yields exactly 1 record with `identification_number == '12345678'`; on the branch, `SELECT count(*) FROM customers WHERE identification_number='12345678'` == 1 and no row has internal spaces/dots in identification_number.

---

## SCEN-010: placeholder discard count outside expected range blocks commit

**Given**: commit mode (not --dry-run) AND the number of unique discarded placeholder identifications falls OUTSIDE the expected range [50, 200] (e.g. the provisional `^123\d{4,}$` regex over-matched and discarded 600 ids — a signal the regex is wrong for this data).
**When**: the ETL runs in commit mode.
**Then**: the gate FAILS — the whole transaction is rolled back, exit code = 7, zero rows written; the summary reports `placeholders_discarded.within_expected_range = false`. In --dry-run mode the run still completes and enumerates the full discarded-id list (the operator's evidence to re-tune the regex) without the range blocking anything.
**Evidence**: gate unit test (or injected-count test) shows commit-mode `gate_pass == False` when placeholder unique-id count ∉ [50,200]; the run exits 7 with `committed=false`; `SELECT count(*) FROM customers WHERE _legacy_migrated_at IS NOT NULL` unchanged; dry-run with the same data still emits `discarded_identifications` in full.

---

## SCEN-011: control characters are sanitized; one bad row never aborts its batch

**Given**: a legacy `fullname` / `email` / `phone` containing a NUL byte (`\x00`) or other control character (MariaDB text can hold bytes Postgres text cannot).
**When**: the ETL extracts and inserts.
**Then**: the control characters are stripped during extraction so the row inserts cleanly; AND if a row still raises a Postgres error inside a batch, the batch falls back to row-by-row insert so the single offending row is isolated as `rejected` while the other rows in that batch still insert — one bad row never rolls back up to 500 good rows.
**Evidence**: unit test asserts the extract coercion strips `\x00` from a `fullname` (e.g. `"JU\x00AN"` → `"JUAN"`); unit/integration test of the insert path shows a batch containing one DB-rejecting row commits the rest and reports exactly one `rejected` (not the whole batch); the gate's `unexpected_rejects` reflects only genuinely bad rows.

---

## SCEN-012: every legacy row is accounted for (reconciliation invariant)

**Given**: a legacy dataset that includes rows with NULL/blank `identification` (which cannot become a customer).
**When**: the ETL runs.
**Then**: blank/NULL-identification rows are COUNTED in a `dropped_no_identification` bucket (not silently skipped); and the summary satisfies the invariant `legacy_rows_total == inserted + skipped_total + rejected_total + placeholder_reservations + dropped_no_identification` — every input row has exactly one disposition.
**Evidence**: summary includes `dropped_no_identification` ≥ 0 and `legacy_rows_total`; a unit/integration assertion that the five disposition buckets sum to the total scanned; a blank-identification input increments `dropped_no_identification` by 1.

---

## SCEN-013: zero-date / unparseable legacy timestamps are surfaced, not silently zeroed

**Given**: a legacy row whose `created_at` or `updated_at` is a MariaDB zero-date (`0000-00-00 00:00:00`, surfaced by the driver as NULL or a string) or otherwise not a usable datetime.
**When**: the ETL extracts and dedups.
**Then**: a parseable string timestamp IS parsed; an unparseable/zero one is counted in a `timestamp_fallback` bucket surfaced in the summary (not silently written as year 0001), so the operator can see how many customers would carry a synthetic timestamp before committing.
**Evidence**: unit test that a valid string timestamp parses to the correct datetime and a zero/garbage value routes to the fallback path; summary includes `timestamp_fallback` count; a row with an unparseable timestamp increments it.

---

## Verification matrix

| Scenario | Surface | Verification |
|---|---|---|
| SCEN-009 | unit + DB | `unittest` for normalize_identification + dedup; SQL on branch |
| SCEN-010 | unit + DB | gate unit test with injected counts; commit-mode exit 7 on branch |
| SCEN-011 | unit + DB | `unittest` for control-char strip + row-by-row fallback; branch run |
| SCEN-012 | unit + DB | summary invariant assertion; blank-id input test |
| SCEN-013 | unit | `unittest` for timestamp parse/fallback + summary counter |

Unit-level coverage is the deterministic gate authored before the fixes. DB-surface confirmation rides on the same disposable-branch dry-run as the original holdout.
