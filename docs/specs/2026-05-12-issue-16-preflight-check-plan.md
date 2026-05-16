# Implementation Plan — Migration pre-flight checks

**Date**: 2026-05-12
**Spec**: `docs/specs/2026-05-12-issue-16-preflight-check-design.md`
**Scenarios**: `docs/specs/2026-05-12-issue-16-preflight-check/scenarios/preflight-check.scenarios.md`
**Issue**: [#16](https://github.com/amaw-sas/rentacar-dashboard/issues/16)
**Audit ref**: [#13](https://github.com/amaw-sas/rentacar-dashboard/issues/13), commit `c70503e`

## Goal

Build a read-only Python script that validates four lookups from the legacy MariaDB to the destination Supabase (franchises, branches, vehicle_categories, identification_type) before any ETL runs. The script must surface gaps explicitly via exit codes and a JSON report so the operator can branch downstream automation on its outcome. Blocking dependency for [#19], [#20], [#21].

## File Map

| File | Change | Responsibility |
|---|---|---|
| `scripts/migration/preflight-check.py` | New | Single-file script. Loads env, opens two connections, executes 4 `Check` definitions, computes `legacy − destination` gaps per check, writes JSON report, prints stdout summary, exits with semantic code. |
| `scripts/migration/.env.example` | New | Template for the 5 required env vars (`LEGACY_DB_HOST`, `LEGACY_DB_USER`, `LEGACY_DB_PASSWORD`, `LEGACY_DB_NAME`, `SUPABASE_DB_URL`) with empty values. |
| `scripts/migration/README.md` | New | Operator-facing instructions: venv setup, dependency install, running the script, interpreting exit codes. |
| `.gitignore` | Edit | Add `scripts/migration/.env` and `docs/migration-runs/` to keep secrets and run reports out of git. |
| `docs/migration-runs/` | Created lazily | Output directory created by the script on first run. Gitignored. Never committed. |

No new top-level directories beyond `scripts/migration/`. No package manifest (no `requirements.txt`) — the README documents the three `pip install` commands so the venv stays operator-managed and out of git. No code outside `scripts/migration/`.

## Prerequisites

- Python 3.11+ available locally (`python --version`). On Debian/Ubuntu/WSL the stdlib `venv` module ships separately — `sudo apt install python3-venv` if `python -m venv` fails with `ensurepip is not available` (observed on this WSL host 2026-05-15).
- Legacy MariaDB local instance (`rentacar_audit`) loaded with the audit dump (already done in audit phase — commit `c70503e`).
- `SUPABASE_DB_URL` available — the connection string from Supabase project settings (`Project Settings → Database → Connection string → URI`). The service-role key is NOT used here; we use direct Postgres connection. If the DB password is unknown, reset it (`Project Settings → Database → Reset database password`) — safe for the dashboard, which is fully key-based (`@supabase/ssr`) and uses no direct Postgres connection; only `supabase db push` needs re-auth afterward.
- Operator can write to `docs/migration-runs/` (default; fallback to `/tmp` on permission failure per design §Error handling).
- For SCEN-002 (red half): a Supabase branch with the 4 localiza categories `G/GR/LP/VP` deleted. **Reality check 2026-05-15: #17 is ALREADY applied to prod** (the 4 categories exist with `status='inactive'`, created 2026-03-30) — so prod is the GREEN state (SCEN-001), and the red state must be synthesized on a disposable Supabase branch. This inverts the original plan's assumption.

## Implementation Steps

Each step is independently testable, references the scenarios it satisfies, and produces a demoable increment.

### Step 1 — Scaffolding + env template + gitignore

Drop in `scripts/migration/preflight-check.py` as a stub that prints its name and exits 0 — gives us a callable artifact before any logic exists. Alongside it: `.env.example` (the 5 required vars with empty values, inline comments on each), and a brief `README.md` covering venv setup (`python -m venv .venv && source .venv/bin/activate && pip install pymysql psycopg2-binary python-dotenv`) plus a one-liner on what the script does. Finally, extend `.gitignore` to cover `scripts/migration/.env` and `docs/migration-runs/`.

- **Size**: S
- **Dependencies**: none
- **Acceptance**: `python scripts/migration/preflight-check.py` exits 0; `scripts/migration/.env.example` lists all 5 vars; `git status` shows the new files staged but `scripts/migration/.env` (if created from the example) is ignored.
- **Satisfies**: scaffolding for SCEN-003 (env var validation will read from `.env.example` structure).

### Step 2 — Env var validation + connection layer (SCEN-003, SCEN-004 foundation)

Implement `dotenv.load_dotenv()` call, `validate_env()` that returns the list of missing required vars, `connect_legacy()` using pymysql, `connect_destination()` using psycopg2. Both connection helpers use `try/except` and re-raise with a sanitized message that does NOT leak credentials. Implement URL masking (`postgresql://***@host:port/db`) for any error message that references `SUPABASE_DB_URL`. Wire into `main()`: validate env first → if missing return exit 4 → else open legacy → if fail return exit 2 → else open destination → if fail return exit 2. Still no checks executed yet.

- **Size**: M
- **Dependencies**: Step 1
- **Acceptance**: running with a missing var exits 4 and lists the missing name on stderr (SCEN-003); running with bad `SUPABASE_DB_URL` exits 2, stderr says "destination connection failed", and `grep` for the password substring in stderr returns nothing (SCEN-004).
- **Satisfies**: SCEN-003, SCEN-004.

### Step 3 — Check dataclass + the four `CHECKS` definitions

Define `@dataclass Check(name, description, legacy_query, destination_query, static_destination)` and `@dataclass CheckResult(name, legacy_count, destination_count, legacy_values, destination_values, gaps, passed, error)`. Define the four `Check` instances exactly as in the design (§Las 4 queries), including the `WHERE rc.code = 'localiza'` filter on checks 2 and 3, and the static sets for franchises and identification_type. No execution logic yet — just the data structures.

- **Size**: S
- **Dependencies**: Step 2
- **Acceptance**: importing the module (or running with a debug print) lists exactly 4 checks with the correct names; the SQL strings match the design verbatim.
- **Satisfies**: foundation for SCEN-001, SCEN-002.

### Step 4 — `run_check` execution + gap computation (SCEN-002)

Implement `run_check(check, legacy_cur, dest_cur) -> CheckResult`: execute `legacy_query`, materialize the set of returned values; if `static_destination` is provided use it directly, else execute `destination_query` and materialize that set; compute `gaps = sorted(legacy − destination)`; wrap each side in its own `try/except` so that a query failure on one check populates `CheckResult.error` but does NOT abort the run — other checks continue. `passed = (len(gaps) == 0 and error is None)`. Wire into `main()`: iterate `CHECKS`, collect `CheckResult`s.

- **Size**: M
- **Dependencies**: Step 3
- **Acceptance**: running against a red-state Supabase branch (the 4 localiza categories `G/GR/LP/VP` deleted) produces a `CheckResult` for `categories` with `gaps == ["G", "GR", "LP", "VP"]` (sorted) and `passed == False`; the other three checks complete and pass. (Current prod can NOT exercise this — #17 is already applied there.)
- **Satisfies**: SCEN-002 (gap detection core logic).

### Step 5 — Report writer: JSON file + stdout summary (SCEN-005)

Two writers and a path helper. `write_json_report(results, path)` produces the exact JSON shape from the design §Estructura del JSON de salida (top-level `timestamp`, `legacy_source`, `destination_source` masked, `passed`, `checks[]`). `print_stdout_summary(results)` renders a 5-column table: `name | legacy_count | dest_count | gaps_count | status`. `output_path()` returns `docs/migration-runs/preflight-<UTC-ISO-timestamp>.json`, falling back to `/tmp/preflight-<ts>.json` with a stderr warning if the docs path isn't writable — exit code only escalates to 5 if both paths fail; otherwise the gap-based 0/1 still applies. Wire into `main()` after the check loop.

- **Size**: M
- **Dependencies**: Step 4
- **Acceptance**: running twice consecutively produces two JSON files that differ only in `timestamp` and filename — all other fields including `gaps` arrays are identical (SCEN-005); stdout shows the summary table; the report file is well-formed JSON parseable by `json.tool`.
- **Satisfies**: SCEN-005 (idempotency observable via report comparison), supports SCEN-001/SCEN-002 reporting.

### Step 6 — Exit code logic + final wiring (SCEN-001)

Implement the final return: `0` if all `result.passed`; `1` if any check has `gaps` (and no errors); `3` if any check has `error` populated (query failure on a present table); `5` if report write failed entirely. The 2/4 codes are already handled in Step 2. Add `try/finally` around the connection lifetime to ensure cursors and connections close even if an unexpected exception bubbles up. Confirm no exception escapes to a Python traceback in the normal exit paths — all error paths return a documented code.

- **Size**: S
- **Dependencies**: Step 5
- **Acceptance**: running against current prod (all gaps resolved — #17 already applied) exits 0 and the report has `passed: true` (SCEN-001); running against the red-state Supabase branch exits 1 (SCEN-002); running with a deliberately broken SQL exits 3.
- **Satisfies**: SCEN-001, SCEN-002 (exit code half).

### Step 7 — Manual red-green verification + evidence capture

Run the full verification matrix from the scenarios file (SCEN-001..006). Capture for each scenario: the command run, exit code, stdout snippet, stderr snippet (where relevant), and the JSON report path. Save evidence in a brief `docs/migration-runs/preflight-verification-2026-05-12.md` (this verification doc IS committed since it documents the rojo-verde cycle; the gitignore only covers the auto-generated `preflight-*.json` reports). **Strategy inverted from the original plan (reality 2026-05-15: #17 already in prod):** SCEN-001 (green, exit 0) is verified against current prod; SCEN-002 (red, exit 1) is verified against a disposable Supabase branch where the 4 localiza categories `G/GR/LP/VP` are deleted. The branch is created immediately before the SCEN-002 run and deleted immediately after (cost containment). SCEN-006 mutates one check query to an invalid relation, asserts exit 3, and confirms the other three checks still complete (design §Error handling per-check isolation).

- **Size**: M (was S — Supabase branch lifecycle added)
- **Dependencies**: Step 6; `scripts/migration/.env` populated with `LEGACY_DB_*` + prod `SUPABASE_DB_URL`; branch-create authorization (cost).
- **Acceptance**: verification doc exists with evidence captured for ALL of SCEN-001..006. No scenario deferred — the inverted strategy makes every scenario observable.
- **Satisfies**: all scenarios via execution evidence (the SDD satisfaction gate).

## Phase grouping

| Phase | Steps | Outcome |
|---|---|---|
| Foundation | 1, 2 | Script runs, env validates, connections open or fail cleanly |
| Core | 3, 4 | Checks execute, gaps detected correctly |
| Output | 5, 6 | Reports produced, exit codes correct |
| Verification | 7 | Evidence captured for SDD satisfaction gate |

## Testing strategy

Manual red-green only. The design already justifies this: ~250 lines of read-only one-off script, pytest scaffolding doesn't earn its keep here.

1. **Green half** (current prod — #17 already applied, the 4 categories exist inactive): SCEN-001 must produce exit 0 with all four checks passing.
2. **Red half** (disposable Supabase branch with `G/GR/LP/VP` deleted from localiza): SCEN-002 must produce exit 1 with the 4 category gaps surfacing. If it doesn't, the script has a false negative and shouldn't ship — that's the whole point of running it.

> Environments inverted vs. the original plan: prod turned out to already carry #17, so prod is now the green reference and the red state is synthesized on a branch.

Steps 1–6 get exercised through SCEN-001 to SCEN-006. The scenarios file's verification matrix documents the evidence to capture for each.

## Rollout plan

- **Branch**: `feat/migration-preflight-issue-16` (already created, design doc committed).
- **PR**: Single PR covering this implementation + the verification evidence doc. The design + plan + scenarios stand as the PR description's substance; reviewer reads them as the contract.
- **Merge**: After PR review approval. No deployment — this is a local operator script, not part of the dashboard runtime. The dashboard build is untouched.
- **Post-merge**: the operator runs the script as the gating step before any of [#19], [#20], [#21] kicks off. Each ETL ticket's plan references this script in its preconditions.

## Rollback

Trivial. The script writes nothing to production databases — it's read-only on both sides. If a check produces a wrong verdict (false positive or false negative), revert the script via `git revert` of the merge commit. No data cleanup needed because no data was written.

## Resolved decisions

- **#17 reality + strategy inversion (corrected 2026-05-15).** Initial decision deferred SCEN-001 on the assumption that #17 was not applied. **MCP read-only verification against prod proved the opposite:** `G/GR/LP/VP` exist for localiza with `status='inactive'`, created 2026-03-30 — #17 is already in prod. Consequence: prod is the GREEN reference (SCEN-001, exit 0); SCEN-002's red state must be synthesized on a disposable Supabase branch (delete the 4 categories there). No scenario is deferred. The holdout scenarios are unchanged (they are state-parameterized — only which environment satisfies each Given moved); no amend needed.
- **Resilience stress-test → INCLUDED as SCEN-006.** The per-check transaction isolation in design §Error handling is now an explicit holdout scenario: mutate one check query to an invalid relation, assert exit 3, confirm the other three checks still complete. Implemented behavior lives in Step 4; verified in Step 7.

## References

- Design spec: `docs/specs/2026-05-12-issue-16-preflight-check-design.md`
- Scenarios: `docs/specs/2026-05-12-issue-16-preflight-check/scenarios/preflight-check.scenarios.md`
- Audit doc: `docs/migration-data-legacy-audit.md` §6 #N1
- Issue: [#16](https://github.com/amaw-sas/rentacar-dashboard/issues/16)
- Blocking dependents: [#19](https://github.com/amaw-sas/rentacar-dashboard/issues/19), [#20](https://github.com/amaw-sas/rentacar-dashboard/issues/20), [#21](https://github.com/amaw-sas/rentacar-dashboard/issues/21)
- Sibling dependent: [#17](https://github.com/amaw-sas/rentacar-dashboard/issues/17) — already applied to prod (verified 2026-05-15: `G/GR/LP/VP` present, `status='inactive'`, created 2026-03-30); prod is the SCEN-001 green reference
