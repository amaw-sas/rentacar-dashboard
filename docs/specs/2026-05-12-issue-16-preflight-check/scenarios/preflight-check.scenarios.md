---
name: preflight-check
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-12T00:00:00Z
spec: docs/specs/2026-05-12-issue-16-preflight-check-design.md
issue: 16
---

# Scenarios — Migration pre-flight checks

Holdout contract for issue #16. Write-once after first commit.
Mirrors the "Observable scenarios" section of the design spec.

Target: `scripts/migration/preflight-check.py` — single-file Python script that validates legacy → destination lookups before any ETL writes. Read-only on both sides. Outputs a JSON report and exits with a code that callers can branch on.

The four checks: `franchises`, `branches`, `categories`, `identification_type`. The legacy source is the local MariaDB `rentacar_audit` (loaded from the audit dump in commit `c70503e`). The destination source is Supabase prod via `SUPABASE_DB_URL`.

---

## SCEN-001: happy path with all gaps resolved

**Given**: the legacy dump is loaded in MariaDB local (`rentacar_audit`) AND the Supabase destination has the 4 legacy categories `GR`, `VP`, `G`, `LP` present in `vehicle_categories` with `status='inactive'` for `rental_company.code='localiza'` (i.e. issue #17 has been applied).
**When**: the operator runs `python scripts/migration/preflight-check.py`.
**Then**: exit code = 0; stdout prints a summary table where all 4 checks (`franchises`, `branches`, `categories`, `identification_type`) show `passed=true` and `gaps=[]`; the file `docs/migration-runs/preflight-<UTC-timestamp>.json` is created with `passed: true` at the top level.
**Evidence**: command exit code captured (`echo $?` → `0`); JSON report read back and parsed asserting `passed === true` and `checks[*].gaps.length === 0` for all four.

---

## SCEN-002: gap detection in categories

**Given**: the Supabase destination does NOT have the 4 legacy categories (`GR`, `VP`, `G`, `LP`) — i.e. current prod state before issue #17 is applied. Legacy dump unchanged.
**When**: the operator runs the script.
**Then**: exit code = 1; the JSON report shows `passed: false` globally; the `categories` check has `passed: false` and `gaps` containing exactly the set `{"GR", "VP", "G", "LP"}` (order-independent); the other three checks (`franchises`, `branches`, `identification_type`) have `passed: true`. Stdout summary table marks `categories` as FAIL.
**Evidence**: exit code captured; JSON parsed asserting `gaps` for categories check is exactly `["GR","VP","G","LP"]` as a sorted set; other three checks' `gaps` arrays are empty.

---

## SCEN-003: missing required env var

**Given**: the operator's `.env` file is missing `SUPABASE_DB_URL` (or any other required var). All other env vars present.
**When**: the operator runs the script.
**Then**: exit code = 4; stderr lists the missing variable name(s); no JSON report file is created; no database connection is opened on either side.
**Evidence**: exit code captured; stderr captured contains the missing var name; `ls docs/migration-runs/preflight-*.json` after the run shows no new file matching the run's timestamp.

---

## SCEN-004: destination connection failure

**Given**: legacy MariaDB is reachable, BUT `SUPABASE_DB_URL` points to an unreachable host or has invalid credentials (simulated by temporarily editing the URL).
**When**: the operator runs the script.
**Then**: exit code = 2; stderr contains the phrase "destination connection failed" (or equivalent) AND identifies which side failed; the password and full URL are NOT printed (URL appears masked, e.g. `postgresql://***@host:port/db`); no check executes; no JSON report is written.
**Evidence**: exit code captured; stderr captured grepped for "destination" and absence of the literal password substring; no new JSON file in `docs/migration-runs/`.

---

## SCEN-005: idempotency across consecutive runs

**Given**: legacy and destination are stable (no schema/data changes between runs).
**When**: the operator runs the script twice consecutively.
**Then**: both runs produce the same exit code, the same global `passed` value, and the same `gaps` arrays per check (treating gaps as sets — order doesn't matter); only the `timestamp` field and the output filename differ between the two report files.
**Evidence**: two consecutive runs captured; both report files parsed and compared with timestamp/filename excluded — diff is empty.

---

## SCEN-006: per-check query-failure isolation

**Given**: legacy MariaDB and the Supabase destination are both reachable, BUT one check's query is deliberately broken to point at a non-existent relation (e.g. the `branches` check's `legacy_query` is altered to `SELECT DISTINCT code FROM branches_NO_SUCH_TABLE`), simulating a typo or a missing legacy table. The other three checks' queries are unchanged.
**When**: the operator runs the script.
**Then**: exit code = 3 (query failure dominates over a plain gap); the JSON report shows `passed: false` globally; the broken check (`branches`) has `error` populated with a non-null message that names the failing side and the underlying SQL error, and `passed: false`; the OTHER three checks (`franchises`, `categories`, `identification_type`) still execute to completion and carry their normal `gaps`/`passed`/`error: null` values — the broken check does NOT abort the run nor poison the destination transaction for the others. Stdout summary renders all four rows, with `branches` flagged as an error status distinct from FAIL.
**Evidence**: exit code captured (`echo $?` → `3`); JSON parsed asserting `checks[branches].error` is non-null and `checks[branches].passed === false`, AND the other three checks are present with `error === null` (their `passed` reflecting real gap state, not the broken check); stdout shows four rows including the error-flagged `branches`.

---

## Verification matrix

| Scenario | Verification approach | Required state |
|---|---|---|
| SCEN-001 | Run with #17 applied locally or on a Supabase branch | Branch with 4 new categories |
| SCEN-002 | Run against current Supabase prod | Default state (no #17) |
| SCEN-003 | Temp-rename a required var, run, restore | `.env` editable |
| SCEN-004 | Temp-edit `SUPABASE_DB_URL` to invalid host, run, restore | `.env` editable |
| SCEN-005 | Run twice in succession, diff reports | Either state above |
| SCEN-006 | Temp-mutate one check query to an invalid relation, run, restore | Both sides reachable |

SCEN-001 may be deferred if a Supabase branch for #17 is not available at verification time — SCEN-002 alone establishes that the script detects real gaps (the red half of red-green). SCEN-006 establishes that a single broken query degrades to a reported error without aborting the remaining checks (per design §Error handling: per-check transaction isolation).
