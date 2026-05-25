---
name: etl-customers
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-22T00:00:00Z
spec: docs/migration-data-legacy-audit.md (§2.2, §3 P1/P2/P3, §4) + approved plan issue #19
issue: 19
---

# Scenarios — Legacy customers ETL

Holdout contract for issue #19. Write-once after first commit.

Target: `scripts/migration/etl-customers.py` — single-file Python ETL that extracts unique customers from the legacy MariaDB `rentacar_audit` (table `reservations`, 12,967 rows) and inserts them deduplicated into Supabase `public.customers`. Reads legacy via `pymysql`, writes destination via `psycopg2` (`autocommit=False`, transactional). Reuses scaffolding from `preflight-check.py` (env validation, masked URL, atomic report writes, exit-code contract).

Two validation surfaces:
- **Pure transform functions** (fullname split, identification_type mapping, placeholder detection, dedup) are deterministic and unit-tested in `scripts/migration/test_etl_customers.py` (stdlib `unittest`, no DB) — encodes SCEN-002/003/004/006 at the unit level before implementation.
- **DB-interaction behavior** (insert / idempotency / rollback / connection contract) is validated by EXECUTION against a disposable Supabase branch with SQL evidence, documented in `docs/migration-runs/etl-customers-verification-<date>.md` (mirrors the #16 verification-evidence pattern).

Key invariants:
- Destination `customers` has `UNIQUE(identification_number)` — single column. Dedup key MUST be `TRIM(identification)` alone, never the audit's composite `(identification_type, identification)`.
- Marker column `_legacy_migrated_at timestamptz` (migration 048) is set to a run timestamp on every ETL-inserted row; dashboard-created rows keep it NULL.
- Insert uses `ON CONFLICT (identification_number) DO NOTHING` — preference to any pre-existing row (dashboard or prior run).

The legacy `identification_type` values are `Cedula Ciudadania` / `Cedula Extranjeria` / `Pasaporte` → `CC` / `CE` / `PP`.

---

## SCEN-001: happy-path full extract + dedup + insert

**Given**: the legacy dump is loaded in MariaDB local (`rentacar_audit`) AND a Supabase branch has migrations through 048 applied (so `customers._legacy_migrated_at` exists) AND `customers` is at a known starting count `C0` (branch seed of prod customers, all with `_legacy_migrated_at IS NULL`).
**When**: the operator runs `python scripts/migration/etl-customers.py` in commit mode against the branch (`SUPABASE_DB_URL` → branch session pooler).
**Then**: exit code = 0; the run report's `inserted` equals `computed_unique_non_placeholder` (the count of distinct `TRIM(identification)` after placeholder filtering, computed read-only from legacy); every newly inserted row has `_legacy_migrated_at IS NOT NULL`; 0 rows are reported `rejected`; `SELECT count(*) FROM customers` == `C0 + inserted`; the count of rows with `_legacy_migrated_at IS NULL` is unchanged at `C0`.
**Evidence**: `echo $?` → `0`; report JSON `inserted` field; SQL `SELECT count(*) FROM customers WHERE _legacy_migrated_at IS NOT NULL` == `inserted`; SQL `SELECT count(*) FROM customers WHERE _legacy_migrated_at IS NULL` == `C0`; read-only legacy `SELECT count(DISTINCT TRIM(identification)) ...` (placeholder-filtered) == `inserted`.

---

## SCEN-002: placeholder identifications are discarded (Q11)

**Given**: the legacy data contains identifications matching the junk patterns `^0+$` (all zeros) and the sequential pattern (e.g. `1234566`, `1234567`).
**When**: the ETL runs.
**Then**: no customer with such an identification is ever inserted; each discarded legacy row is logged with `action="skipped"`, `reason="placeholder"`; the report aggregate `placeholders_discarded` reports `{unique_ids, reservations}` and these are LOGGED-AND-VALIDATED against the audit expectation (~90 unique ids / ~215 reservations) — a mismatch is surfaced in the report, not silently asserted.
**Evidence**: SQL on destination `SELECT count(*) FROM customers WHERE identification_number ~ '^0+$'` == `0` AND no inserted row matches the sequential pattern; report `placeholders_discarded.unique_ids` and `.reservations` present; unit test `test_is_placeholder` asserts the regex classifies `'0'`, `'00000'`, `'1234566'` as placeholder and a real cedula like `'1032456789'` as NOT placeholder.

---

## SCEN-003: one-token fullname → last_name '.' + needs_review (Q1)

**Given**: a legacy `fullname` consisting of a single token (e.g. `'MARIA'`), with a valid non-placeholder identification.
**When**: the ETL transforms and inserts it.
**Then**: the resulting customer row has `first_name='MARIA'` and `last_name='.'` (a period — never empty, satisfying `last_name NOT NULL`); the row is logged with `needs_review=true`; the report aggregate `needs_review` counts all such one-token rows.
**Evidence**: unit test `test_split_fullname_one_token` asserts `split_fullname('MARIA') == ('MARIA', '.')` and the result is flagged needs_review; on the branch, SQL `SELECT first_name,last_name FROM customers WHERE identification_number=<the one-token id>` returns `('MARIA','.')`; report `needs_review` ≥ 1.

---

## SCEN-004: dedup latest-wins by updated_at

**Given**: two (or more) legacy reservations share the same `TRIM(identification)` but carry different `fullname` / `email` / `phone` and different `updated_at` timestamps.
**When**: the ETL dedups and inserts.
**Then**: exactly one customer exists for that identification; its `first_name`/`last_name`/`email`/`phone`/`identification_type` come from the record with the MAX `updated_at`; its `created_at` is the MIN and `updated_at` is the MAX across the group; the divergence is logged in the report aggregate `conflicts_resolved` (`by_name` / `by_email` / `by_phone`) without blocking.
**Evidence**: unit test `test_dedup_latest_wins` builds 3 in-memory records for one id with ascending `updated_at` and asserts the winner is the latest record's fields, `created_at==min`, `updated_at==max`; on the branch, SQL `SELECT count(*) FROM customers WHERE identification_number=<dup id>` == `1` and field values match the latest source row; report `conflicts_resolved.by_name` ≥ 1 for the seeded divergence.

---

## SCEN-005: idempotent re-run inserts zero

**Given**: a completed ETL run (branch or prod) where N rows were inserted with the marker set.
**When**: the operator runs the ETL a second time, unchanged.
**Then**: exit code = 0; the second run's report `inserted` == `0`; no duplicate rows are created; no field on any existing row changes (no churn of `updated_at`); skips are classified `reason="already_migrated"` (marker already set) vs `reason="conflict_existing"` (dashboard-owned, marker NULL).
**Evidence**: second-run report `inserted` == `0`; SQL `SELECT count(*) FROM customers` identical before and after the second run; SQL `SELECT max(updated_at) FROM customers WHERE _legacy_migrated_at IS NOT NULL` identical across the two runs; report shows `skipped.already_migrated` == N.

---

## SCEN-006: identification_number cross-type collision never violates UNIQUE

**Given**: two legacy reservations share the same `TRIM(identification)` but have different `identification_type` (e.g. one `Cedula Ciudadania` and one `Cedula Extranjeria`).
**When**: the ETL runs.
**Then**: a single customer row exists for that number (no `UNIQUE` violation, 0 SQL constraint errors); its `identification_type` is the latest record's mapped type; the collision is logged with `reason="cross_type_id"` listing both types seen and the winner.
**Evidence**: unit test `test_dedup_cross_type` asserts a single deduped record results from two same-number different-type inputs and records a cross_type conflict; on the branch, the run reports 0 `rejected` with a UNIQUE/constraint reason AND `SELECT count(*) FROM customers WHERE identification_number=<x>` == `1`; report `conflicts_resolved.cross_type` ≥ 1.

---

## SCEN-007: rollback removes only ETL rows, never dashboard-created customers

**Given**: a completed ETL run on the branch (N marked rows) AND a customer created with `_legacy_migrated_at IS NULL` simulating a dashboard insert during the migration window (part of the `C0` seed or inserted manually).
**When**: the operator runs `docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql`.
**Then**: all rows with `_legacy_migrated_at IS NOT NULL` are deleted; the count returns to `C0`; the specific marker-NULL customer still exists; no ETL row remains.
**Evidence**: pre-rollback `SELECT count(*) FROM customers` == `C0 + N`; rollback reports `N` rows deleted; post-rollback `SELECT count(*) FROM customers` == `C0`; `SELECT count(*) FROM customers WHERE _legacy_migrated_at IS NOT NULL` == `0`; `SELECT 1 FROM customers WHERE id=<the marker-NULL id>` returns the row.

---

## SCEN-008: env / connection failure contract (inherited from preflight)

**Given**: a required env var (`LEGACY_DB_HOST`/`USER`/`PASSWORD`/`NAME` or `SUPABASE_DB_URL`) is missing or empty; OR all env present but `SUPABASE_DB_URL` points at an unreachable host.
**When**: the operator runs the ETL.
**Then**: for missing env → exit code = 4, stderr names the missing var(s), no DB connection opened, no rows written; for unreachable destination → exit code = 2, stderr says the destination connection failed with the URL MASKED (`postgresql://***@host:port/db`, password absent), no partial commit. In both cases `SELECT count(*) FROM customers WHERE _legacy_migrated_at IS NOT NULL` is unchanged.
**Evidence**: `echo $?` → `4` (missing env) / `2` (unreachable); stderr captured contains the var name / the phrase "destination connection failed"; the literal password substring is absent from all output; destination marker-row count unchanged before/after.

---

## Verification matrix

| Scenario | Surface | Verification approach | Required state |
|---|---|---|---|
| SCEN-001 | DB exec | Full ETL run against disposable branch, commit mode | Branch w/ migrations ≤048 + customers seed |
| SCEN-002 | unit + DB | `unittest` for regex + SQL count on branch | Branch + legacy loaded |
| SCEN-003 | unit + DB | `unittest` for split + SQL row read on branch | Branch + legacy loaded |
| SCEN-004 | unit + DB | `unittest` for dedup + SQL on branch | Branch + legacy loaded |
| SCEN-005 | DB exec | Run twice, diff counts/report | Branch post SCEN-001 |
| SCEN-006 | unit + DB | `unittest` for cross-type + run report | Branch + legacy loaded |
| SCEN-007 | DB exec | Run rollback.sql, assert counts | Branch post SCEN-001 + a marker-NULL row |
| SCEN-008 | exec | Temp-unset env / temp-break URL, run, restore | `.env` editable |

Unit-level scenarios (002/003/004/006) run with `python -m unittest` and require no database — they are the deterministic red-green gate authored before the ETL. DB-interaction scenarios (001/005/007/008) are validated by branch execution with SQL evidence and captured in the verification doc; the disposable branch is deleted after the run (cost contained), per the #16 precedent.
