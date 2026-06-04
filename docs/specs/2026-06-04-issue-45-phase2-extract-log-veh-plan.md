# Implementation Plan — Issue #45 Phase 2: faithful raw extraction of legacy `log_veh`

**Design:** `docs/specs/2026-06-04-issue-45-phase2-extract-log-veh-design.md` (approved, spec-review passed)
**Scenarios (holdout):** `docs/specs/2026-06-04-issue-45-phase2-extract-log-veh/scenarios/extract-log-veh.scenarios.md`
**Branch / worktree:** `task/issue-45-phase2-extract-log-veh` / `.worktrees/issue-45-phase2-extract`

Reuses the Phase-1 scaffolding pattern (`size-log-veh.py`): hyphenated single-file
script, lazy pymysql import, pure functions unit-tested on bare Python, atomic
writes, exit-code contract, host masking. The mysqldump subprocess + tunnel
ownership are new.

---

## File map

| File | Responsibility |
|---|---|
| `.gitignore` | Add `/docs/migration-runs/log-veh-extract-*/` — the PII run dir is never committed (B1). |
| `scripts/migration/extract-log-veh.py` | The autonomous driver: freeze id bounds, precondition gate, charset detect, chunk loop with resume, manifest, completeness verdict, exit codes, status file. Pure helpers live at module top for unit testing. |
| `scripts/migration/_tunnel.py` | Tunnel ownership (importable, reusable): launch with keepalives, raw-handshake probe, relaunch on silent death, teardown; distinguishes a driver-created vs pre-existing operator tunnel. |
| `scripts/migration/test_extract_log_veh.py` | Bare-Python unit tests (no pymysql / no mysqldump) for every pure function. |
| `scripts/migration/README.md` | Append a Phase-2 operation section (autonomy, exit codes, scenarios, restore-to-scratch verify recipe). |
| `docs/data-ops/2026-06-04-issue-45-phase2-extract-log-veh/run-summary.md` | Execution narrative + completeness numbers transcribed from the (gitignored) manifest. Written after the real run. |

**Unit surface (deterministic, no DB/subprocess):** PK-range planning over a frozen
`[min_id, max_id_frozen]`; manifest read/merge + resume-skip decision; the exact
3-part completeness verdict; the empty-range vs failed-dump guard
(`rows==0 ⇒ range_count==0`); late-arrival accounting; host masking;
`--defaults-extra-file` content builder (creds never on argv); status-file shaping;
the `^INSERT INTO` row counter over a gunzip stream.

**Execution surface (validated against prod legacy, documented in run-summary):**
charset detection, append-only precondition query, id-bounds freeze, per-chunk
`mysqldump` under the watchdog, tunnel ownership over real SSH, sudo cred fetch,
byte-fidelity round-trip into a scratch MariaDB.

---

## Steps (SDD: scenario → code → satisfy → refactor; each ≤ M, ≤ 2h, no forward deps)

### Step 1 — PII gitignore guard | Size: S | Deps: none
Add `/docs/migration-runs/log-veh-extract-*/` to `.gitignore`.
**Scenario:** SCEN-006 (the ignore half). **Acceptance:** a test asserts
`git check-ignore -v` matches a sample `…/log-veh-extract-X/chunk-…sql.gz`, the
`.partial`, the `manifest.json`, and a `.defaults-extra.cnf` under that dir; and
`git status --porcelain` shows nothing tracked there. This is first so no later
step can accidentally stage a dump.

### Step 2 — PK-range planner + manifest model (pure) | Size: M | Deps: 1
Pure functions: `plan_ranges(min_id, max_id_frozen, chunk_rows)`;
`load_manifest`/`merge_chunk`; `resume_skip(chunk, manifest)`;
`completeness_verdict(manifest)` implementing the exact 3-part rule (all verified ·
partition no-gap/no-overlap · `sum(rows)==reconciled_count`); empty-range guard
shaping; late-arrival accounting (`rows_arrived_during_run`).
**Scenarios:** SCEN-002 (resume), SCEN-004 (integrity/empty-range bookkeeping),
SCEN-007 (completeness/no-silent-gap). **Acceptance:** unit tests — a dropped range
makes the verdict `complete:false`; an overlap is rejected; sum≠reconciled is
rejected; a 0-row chunk needs `range_count==0`; `id>max_id_frozen` lands in
`rows_arrived_during_run`, never in `total_rows`.

### Step 3 — Integrity primitives (pure) | Size: M | Deps: 1
`count_insert_rows(gz_path)` counting `^INSERT INTO \`TABLE\`` lines from the
gunzip stream (O(1) memory); `gzip_ok(path)`; `sha256_file`; `_atomic_write`
(reused from Phase 1).
**Scenario:** SCEN-004 + N1 regression. **Acceptance:** unit test builds a tiny
`--skip-extended-insert`-style gz fixture whose text field literally contains
`),(` and a fake `INSERT INTO` substring inside a quoted value → the counter still
returns the exact row count (proves it counts statements, not tuples/substrings);
a truncated gz fails `gzip_ok`.

### Step 4 — Credentials + host masking (pure + SSH) | Size: M | Deps: 1
`mask_host`; `build_defaults_extra_file(creds) -> 0600 file content` (password
never on argv); `fetch_legacy_creds_via_ssh()` running
`ssh rentacar 'sudo cat /home/rentacar/.env'`, extracting only the 5 `DB_*` keys
and discarding the blob.
**Scenarios:** SCEN-008 (cred half), SCEN-006 (no argv / no blob in logs).
**Acceptance:** unit test — the defaults-extra-file content carries the password
under `[mysqldump]`, and no function returns/echoes the full `.env` blob; host
masking matches Phase 1. (The live `sudo cat` is exercised in Step 8/10.)

### Step 5 — Tunnel ownership (`_tunnel.py`, SSH) | Size: M | Deps: 4
`ensure_tunnel()` (launch with `ServerAliveInterval/CountMax/ExitOnForwardFailure`,
force `127.0.0.1`), `probe_handshake(port)` (reuse Phase-1 raw-greeting probe),
`relaunch_if_dead()`, `teardown(created_by_us)`.
**Scenarios:** SCEN-003 (tunnel death → relaunch), SCEN-008 (own vs pre-existing).
**Acceptance:** unit-level — `probe_handshake` parses a MariaDB greeting and a dead
socket; `teardown` only kills a forwarder the driver started (records its PID),
never a pre-existing one. Live relaunch verified in Step 10.

### Step 6 — Watchdog + single-chunk dump (subprocess) | Size: M | Deps: 3,4,5
`dump_chunk(lo, hi, defaults_file, charset, run_dir)` →
`mysqldump --defaults-extra-file --single-transaction --quick --no-tablespaces
--skip-lock-tables --hex-blob --skip-extended-insert
--default-character-set=<charset> --where="id BETWEEN lo AND hi" | gzip > .partial`,
wrapped in a per-chunk subprocess timeout + stall watchdog (SIGKILL), `gzip_ok`,
`count_insert_rows == range_count`, sha256, atomic rename, manifest append; retry
with backoff up to M.
**Scenarios:** SCEN-004, I4 (watchdog). **Acceptance:** a stubbed dump command that
hangs is SIGKILLed at the timeout and retried; a stubbed dump emitting wrong row
count is discarded, not marked verified.

### Step 7 — Charset detect + append-only precondition gate (DB) | Size: S | Deps: 4,5
`detect_charset(conn)` from `SHOW CREATE TABLE`; `append_only_gate(conn)` running
`COUNT(*) WHERE updated_at <> created_at` → abort exit 4 unless `--allow-eventual`
(then manifest `consistency:"eventual"`).
**Scenario:** SCEN-009. **Acceptance:** unit test of the gate decision function
(0 → proceed point-in-time; >0 → abort unless flag → eventual); the live queries
run in Step 8/10.

### Step 8 — Driver orchestration + status/exit contract | Size: M | Deps: 2,6,7
`run(args)`: connect (pymysql, for metadata only) → `append_only_gate` →
`detect_charset` → freeze `min_id`/`max_id_frozen` → `plan_ranges` → chunk loop
(`resume_skip`, `ensure_tunnel`/`relaunch_if_dead` before each, `dump_chunk`) →
manifest finalize → `completeness_verdict` → exit codes (0/2/3/4/5) → tunnel
teardown. Status file with `current_id`/`bytes`/`last_advance`. Global
`RUN_DEADLINE`. `main(argv)` with `--chunk-rows`, `--allow-eventual`,
`--run-deadline`, `--chunk-timeout`.
**Scenarios:** SCEN-001 (happy-path orchestration), SCEN-002 (resume end-to-end),
SCEN-005b (no locking statements in emitted SQL — assert via a scratch capture),
SCEN-007 (final verdict). **Acceptance:** a dry/stubbed end-to-end (mysqldump
faked) produces a `complete:true` manifest with exact reconciliation; killing
mid-loop and re-invoking resumes to the identical manifest.

### Step 9 — README + run-summary scaffold | Size: S | Deps: 8
Append the Phase-2 operation section to `scripts/migration/README.md` (autonomy,
exit codes, the precise read-only/lock grep, the restore-to-scratch byte-fidelity
recipe for SCEN-005a). Create the empty run-summary doc path.
**Acceptance:** README documents every exit code and the SCEN-005a verify recipe;
no scenario regressions (`python -m unittest` green).

### Step 10 — Real autonomous run + verify | Size: L (wall-clock; unattended) | Deps: 8,9
Launch the driver in the background against prod legacy (off-hours), self-healing
tunnel, ~2h. Monitor via wakeups + status file. On completion: verify SCEN-001
(manifest `complete:true`, exact reconciliation), SCEN-003 (any relaunch logged),
SCEN-005a (restore a sampled chunk into a scratch MariaDB, compare `SHA2()` of
`response_raw`/`processed_data` on a multibyte row), SCEN-005b. Transcribe the
PII-free numbers into the run-summary (via /humanizer). The chunks stay local
(gitignored); operator stores them durably afterward.
**Acceptance:** all execution-validated scenarios satisfied with fresh evidence;
run-summary committed; manifest `complete:true`.

---

## Prerequisites
- Local `mysqldump` (MariaDB 10.11.14) — present. ~6 GiB local disk — 937 GiB free.
- Non-interactive SSH to `rentacar` + passwordless `sudo` — verified 2026-06-04.
- `scripts/migration/.venv` (pymysql) in the **main** checkout (not the worktree) —
  reused from Phase 1. See [[reference_legacy_db_ssh_tunnel_access]].

## Testing strategy
- **Unit (bare Python):** Steps 1–8 pure functions, run via
  `python scripts/migration/test_extract_log_veh.py`. Includes the N1 `),(`
  regression and the completeness/gap/overlap rejections.
- **Execution (prod legacy):** Step 10 — the real run validates the DB/subprocess
  surface and the byte-fidelity round-trip; documented in the run-summary.
- **No CI wiring** (these scripts run manually, like the ETL/Phase-1 scripts).

## Rollout / safety
- Read-only on the source (only `mysqldump` SELECT-equivalent + metadata SELECTs);
  no writes to legacy, no writes to `public.search_logs`.
- Off-hours; non-blocking by construction (§3.2 of design).
- Rollback is trivial: the output is local files; deleting the run dir undoes
  everything. No prod state changes.
- PII never leaves local disk and never enters git (Step 1 gate).
