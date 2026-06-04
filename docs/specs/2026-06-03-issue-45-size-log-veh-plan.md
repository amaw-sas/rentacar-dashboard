# Implementation Plan — Issue #45 Phase 1: size legacy `log_veh`

> Design: `docs/specs/2026-06-03-issue-45-size-log-veh-design.md` (approved 2026-06-03)
> Planning Q&A / research phases: **N/A** — the design is already detailed and
> reviewer-approved; this plan is only the file map + ordered SDD steps.

## File structure (decomposition)

| File | Responsibility | New/Modified |
|---|---|---|
| `scripts/migration/size-log-veh.py` | The sizing script: exit-code constants, pure helpers (`format_bytes`, `build_summary`), env validation, lazy `pymysql` connect with port + session guards, tiered queries, `run()`, `main()`/argparse. Single file, mirrors `etl-customers.py` layout. | New |
| `scripts/migration/test_size_log_veh.py` | Pure unit tests (run on bare Python, no driver): `validate_env`, `build_summary` (happy / timed-out / kill-switch-unconfirmed branches), PII-free key set, `format_bytes`. | New |
| `scripts/migration/README.md` | Append a "Sizing: legacy log_veh (issue #45)" section: tunnel + env setup, running, exit codes, scenarios. | Modified |
| `docs/data-ops/2026-06-03-issue-45-size-log-veh/run-summary.md` | The real-run evidence (Spanish, /humanizer) — written at run time (task #4), not now. | New (later) |

`scripts/migration/.env.example` would ideally gain an optional `LEGACY_DB_PORT`
note; it is permission-denied to the agent, so the README documents the var
instead (operator edits `.env` directly).

## Prerequisites

- Existing venv `scripts/migration/.venv` (already has `pymysql`, `psycopg2-binary`,
  `python-dotenv`). Sizing needs only `pymysql` + `python-dotenv`.
- SSH tunnel up (operator): `ssh -fN -L <local>:<mysql-host>:3306 rentacar`.
- `scripts/migration/.env` populated with `LEGACY_DB_HOST=127.0.0.1`,
  `LEGACY_DB_PORT=<local>`, `LEGACY_DB_USER/PASSWORD/NAME` from the EC2 Laravel `.env`.

## Steps (SDD: scenario → test → code → satisfy)

**Step 1 — Pure core + reused scaffolding | Size: M | Deps: none**
Create `size-log-veh.py` with: exit-code constants (0/2/3/4/5/6, no 7);
`REQUIRED_ENV = [LEGACY_DB_HOST, LEGACY_DB_USER, LEGACY_DB_PASSWORD, LEGACY_DB_NAME]`;
copy `mask_db_url`, `validate_env`, `_atomic_write`, `report_paths` (→ `.json`),
`write_report` (single JSON object, atomic, `/tmp` fallback) from `etl-customers.py`;
pure `format_bytes(n)` and `build_summary(metrics)`. Write `test_size_log_veh.py`.
- *Scenario:* SCEN-002 (validate_env returns missing LEGACY_DB_* names),
  SCEN-004 (build_summary renders a timed-out metric as null + `timed_out_after_s`),
  SCEN-006 (summary/report key set contains no row-payload keys),
  SCEN-007 (build_summary renders `skipped: kill_switch_unconfirmed`).
- *Acceptance:* `python -m pytest test_size_log_veh.py` (or unittest) passes on
  bare Python with NO `pymysql` importable; `build_summary` is pure (no I/O).

**Step 2 — Legacy connect + session safety guards | Size: M | Deps: Step 1**
`connect_legacy()`: lazy `import pymysql`, `connect_timeout=10`, **optional
`LEGACY_DB_PORT` (default 3306)**. Right after connect: `SET SESSION TRANSACTION
READ ONLY`, `SET SESSION max_statement_time=<budget>`, then read back
`SELECT @@max_statement_time` → `confirm_kill_switch()` returns whether the budget
stuck (> 0 and == budget).
- *Scenario:* SCEN-003 (unreachable host → caught → exit 2, host masked, no report),
  SCEN-005 (session is read-only; only SELECT/SET issued), SCEN-007 (read-back 0 →
  caller skips table-scan tiers).
- *Acceptance:* connection errors map to exit 2 with masked host; no
  INSERT/UPDATE/DELETE anywhere in the source (grep-clean).

**Step 3 — Tiered queries + run() orchestration + CLI | Size: M | Deps: Step 2**
`run()`: Tier 1 `information_schema` metadata (schema+table filtered); Tier 2 PK
proxy (`ORDER BY id ASC/DESC LIMIT 1`); Tier 3 protected `COUNT(*)` — wrap in
try/except, a server statement-timeout (pymysql error code 1969/3024 or generic)
→ record `{value: null, timed_out_after_s: budget}`, any OTHER query error →
exit 3; Tier 4 `MIN/MAX(created_at)` only when `--exact-range`. If kill-switch
unconfirmed (Step 2) → skip Tiers 3–4 with `skipped: kill_switch_unconfirmed`.
Assemble metrics → `build_summary` → write JSON report + print stdout table.
`main()`: argparse `--exact-range`, `--budget` (default 15), `--help` (prints
exit-code table).
- *Scenario:* SCEN-001 (full happy path → exit 0, report with approx rows + bytes +
  span), SCEN-004 (a low `--budget` against the real table aborts Tier 3 → null +
  timed_out, run still exit 0).
- *Acceptance:* exit-code discipline holds (timeout ≠ exit 3; real query error =
  exit 3; report-write failure to both paths = exit 5); a successful run writes a
  PII-free JSON report and prints the summary table.

**Step 4 — README section | Size: S | Deps: Step 3**
Append "Sizing: legacy log_veh (issue #45)" to `scripts/migration/README.md`:
tunnel + env setup (incl. `LEGACY_DB_PORT`), running (`--exact-range`, `--budget`),
exit codes, the 7 scenarios, and the non-blocking guarantee rationale.
- *Acceptance:* README matches the script's actual flags and exit codes.

## Testing strategy

- **Unit (bare Python):** `test_size_log_veh.py` covers the pure functions and the
  three `build_summary` branches (happy / timed-out / kill-switch-unconfirmed) +
  the PII-free invariant + `validate_env`. No DB driver needed.
- **Static:** grep the source for `INSERT|UPDATE|DELETE|DROP|REPLACE` → must be
  empty (SCEN-005 read-only invariant).
- **Integration (task #4, real prod legacy via tunnel):** SCEN-001 happy path is
  the real run; SCEN-004 is reproducible with `--budget 1` against the real table;
  SCEN-003 by pointing `LEGACY_DB_HOST` at a dead port. Evidence → run-summary.

## Rollout

- No deployment — an operator-run, read-only, one-shot sizing script. "Rollout" =
  run it once via the tunnel, capture numbers in the run-summary, attach to #45,
  and that evidence selects the Phase 2 extraction method.
- "Rollback" = N/A (writes nothing). Tearing down = `kill` the `ssh -fN` tunnel.
