---
name: size-log-veh
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-03T00:00:00Z
spec: docs/specs/2026-06-03-issue-45-size-log-veh-design.md
issue: 45
---

# Scenarios — Size legacy `log_veh` history (Phase 1)

Holdout contract for issue #45 Phase 1 (sizing only). Write-once after first commit.

Target: `scripts/migration/size-log-veh.py` — single-file, **read-only** Python
script that dimensions the legacy MySQL/MariaDB table
`log_veh_available_rates_queries` before any extraction method is chosen. Connects
via `pymysql` through an SSH tunnel to prod legacy (local tunnel port). Reuses the
`etl-customers.py` scaffolding: `validate_env`, `mask_db_url`, `_atomic_write`,
exit-code contract, lazy driver import. Emits a single PII-free JSON report plus a
stdout summary.

Two validation surfaces:
- **Pure functions** (`build_summary`, `format_bytes`, `validate_env`) are
  deterministic and unit-tested in `scripts/migration/test_size_log_veh.py`
  (stdlib `unittest`, NO `pymysql`) — encodes SCEN-002/004/006/007 at unit level
  before implementation.
- **DB-interaction behavior** (connection contract, session guards, tiered
  queries, the real numbers) is validated by EXECUTION against prod legacy via the
  tunnel, documented in `docs/data-ops/2026-06-03-issue-45-size-log-veh/run-summary.md`.

Key invariants:
- **Non-blocking by construction.** Every table-touching query runs under a
  server-side `SET SESSION max_statement_time=<budget>` (MariaDB, seconds). The
  script verifies the budget took effect (`SELECT @@max_statement_time`) before
  running any scanning tier; if it did not stick, the scanning tiers are skipped,
  never run unprotected.
- **Read-only.** The script issues only `SELECT` and `SET SESSION` statements in a
  `TRANSACTION READ ONLY` session. The source contains no
  `INSERT`/`UPDATE`/`DELETE`/`DROP`/`REPLACE`.
- **PII-free report.** The report holds only metadata, counts, and timestamps —
  never `request_parameters`, `processed_data`, `source_ip`, or any row payload —
  so it is committable (unlike the gitignored ETL JSONL reports).
- A statement-timeout abort on a protected tier is a FINDING, not a failure: the
  metric is recorded null with `timed_out_after_s` and the run still exits 0.
- Exit-code contract (mirror of the ETL): `0` ok · `2` connection (host masked) ·
  `3` real query error (NOT a timeout) · `4` env missing/empty · `5` report not
  persisted to any path · `6` unexpected. No `7` (no commit/gate).

---

## SCEN-001: happy-path sizing run

**Given**: the SSH tunnel to prod legacy is up and `scripts/migration/.env` has all
four `LEGACY_DB_*` vars populated (`LEGACY_DB_HOST=127.0.0.1`, `LEGACY_DB_PORT=`
the tunnel's local port), the server is MariaDB ≥10.1 so `max_statement_time` is
honored, and the table `log_veh_available_rates_queries` exists.
**When**: the operator runs `python scripts/migration/size-log-veh.py`.
**Then**: exit code = 0; a JSON report is written to
`docs/migration-runs/size-log-veh-<UTC-stamp>.json`; the report contains the
metadata tier (`approx_rows` from `TABLE_ROWS`, `data_bytes`, `index_bytes`,
`total_bytes`, `engine`), the temporal-span tier (`first_created_at`/
`last_created_at` with `source: "pk_proxy"`), and the exact-count tier (either a
number or `{value: null, timed_out_after_s}`); stdout prints a human summary table
echoing those numbers; the kill-switch verification (`max_statement_time`
read-back) is recorded as confirmed.
**Evidence**: `echo $?` → `0`; the JSON report file exists and parses; its top-level
keys include `approx_rows`, `total_bytes`, `first_created_at`, `last_created_at`,
`exact_rows`, `kill_switch.confirmed: true`; stdout contains a summary table; the
numbers transcribed into the run-summary.

---

## SCEN-002: missing env var

**Given**: one of the four required `LEGACY_DB_*` vars is unset OR present-but-empty
(e.g. `LEGACY_DB_PASSWORD=""`).
**When**: the operator runs `python scripts/migration/size-log-veh.py`.
**Then**: the script exits 4 before opening any connection; the missing var
name(s) are printed to stderr; no JSON report is written.
**Evidence**: `echo $?` → `4`; stderr names the missing var; no
`size-log-veh-*.json` created this run; unit test `validate_env()` with a blanked
`LEGACY_DB_*` returns that var name (and `LEGACY_DB_PORT` is NEVER in the returned
missing list — it is optional, default 3306).

---

## SCEN-003: legacy connection failure

**Given**: `LEGACY_DB_*` is fully populated but the tunnel is down / the host:port
is unreachable / the credentials are wrong.
**When**: the operator runs `python scripts/migration/size-log-veh.py`.
**Then**: the script exits 2; any message mentioning the connection masks the
host (no raw credential bytes); no JSON report is written; the failure surfaces
within ~10s (connect_timeout), not as an indefinite hang.
**Evidence**: `echo $?` → `2`; stderr says a legacy connection failed with the
host masked; no `size-log-veh-*.json` created this run.

---

## SCEN-004: protected heavy tier hits the time budget (non-blocking guarantee)

**Given**: the table is large enough that an exact `COUNT(*)` would exceed the
configured budget, and the operator runs with a deliberately tiny budget
`python scripts/migration/size-log-veh.py --budget 1` (1 second) against the real
table.
**When**: the run reaches Tier 3 (exact count); the server aborts the query at the
1-second `max_statement_time`.
**Then**: the script catches the statement-timeout (does NOT treat it as exit 3),
records the exact-count metric as `{value: null, timed_out_after_s: 1}`, still
completes the cheap metadata + PK-proxy tiers, flags the timeout in the summary,
and exits 0.
**Evidence**: `echo $?` → `0`; the JSON report's `exact_rows` is
`{value: null, timed_out_after_s: 1}` while `approx_rows`, `total_bytes`, and the
temporal span are all populated; stdout flags the count as timed-out; unit test:
`build_summary` given a metrics dict with a timed-out count renders that metric as
null + `timed_out_after_s` and the overall result as exit-0-eligible.

---

## SCEN-005: read-only invariant

**Given**: the script source and a live session.
**When**: the source is grepped for mutating SQL, and a run connects to legacy.
**Then**: the source contains zero `INSERT`/`UPDATE`/`DELETE`/`DROP`/`REPLACE`
statements; the session runs `SET SESSION TRANSACTION READ ONLY`; the only
statements issued are `SELECT` and `SET SESSION`.
**Evidence**: `grep -iE '\b(insert|update|delete|drop|replace)\b' size-log-veh.py`
returns no SQL-statement match; the report records the session as read-only
(from the `@@max_statement_time` / read-only read-back); no write is ever sent to
legacy.

---

## SCEN-006: report is PII-free and atomic

**Given**: a completed run.
**When**: the JSON report is inspected.
**Then**: its keys are metadata/counts/timestamps only — there is no
`request_parameters`, `processed_data`, `source_ip`, `response_raw`, or any
per-row payload anywhere in it; the file was written atomically (temp file +
rename), so a reader or crash never sees a partial JSON; if the canonical
`docs/migration-runs/` path is unwritable it falls back to `/tmp` and warns, and
only a failure of BOTH paths exits 5.
**Evidence**: the report JSON has no `request_parameters`/`processed_data`/
`source_ip`/`response_raw` keys; unit test asserts the `build_summary` output key
set is a subset of the allowed metadata/count/timestamp keys; a forced
unwritable canonical dir produces a `/tmp` fallback file and a stderr warning, not
exit 5.

---

## SCEN-007: kill-switch unconfirmed → skip the scanning tiers

**Given**: the legacy server does not honor `max_statement_time` (too old, or the
SET silently no-ops), so `SELECT @@max_statement_time` reads back `0` /
unsupported after the SET.
**When**: the operator runs `python scripts/migration/size-log-veh.py`.
**Then**: the script runs ONLY the safe tiers (metadata + PK-proxy span), SKIPS
the table-scanning tiers 3–4 with `skipped: kill_switch_unconfirmed`, flags this
loudly in the summary, and exits 0 — it NEVER runs an unprotected `COUNT(*)` or
`MIN/MAX` against prod legacy.
**Evidence**: the JSON report has `kill_switch.confirmed: false` and
`exact_rows: {skipped: "kill_switch_unconfirmed"}` (and the same for the exact
range when requested); `approx_rows` + temporal span are still present; stdout
warns that the exact count was skipped for safety; `echo $?` → `0`; unit test:
`build_summary` with `kill_switch_confirmed=False` renders the scanning metrics as
`skipped: kill_switch_unconfirmed`.
