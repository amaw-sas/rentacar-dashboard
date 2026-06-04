---
name: extract-log-veh
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-04T00:00:00Z
spec: docs/specs/2026-06-04-issue-45-phase2-extract-log-veh-design.md
issue: 45
phase: 2
---

# Scenarios — Faithful raw extraction of legacy `log_veh` (Phase 2)

Holdout contract for issue #45 Phase 2 (extraction only). Write-once after first
commit.

Target: `scripts/migration/extract-log-veh.py` + `scripts/migration/_tunnel.py` —
an autonomous, resumable driver that produces a faithful 1:1 raw archive of
`log_veh_available_rates_queries` (~657,984 rows / 28.7 GiB, MariaDB 10.11.15) as
gzipped per-PK-range `mysqldump` chunks + a manifest, reached via a driver-owned
SSH tunnel through the EC2 `rentacar`. Read-only on the source; never writes to
`public.search_logs`.

Two validation surfaces:
- **Pure functions** (range planning, manifest/resume, completeness verdict, row
  counting, cred-file builder, host masking, status shaping) are deterministic and
  unit-tested in `scripts/migration/test_extract_log_veh.py` (bare Python, NO
  pymysql / NO mysqldump).
- **DB/subprocess behavior** (real mysqldump through the tunnel, charset detection,
  precondition query, tunnel relaunch, byte-fidelity round-trip, the real archive)
  is validated by EXECUTION against prod legacy and documented in
  `docs/data-ops/2026-06-04-issue-45-phase2-extract-log-veh/run-summary.md`.

Key invariants:
- **Faithful 1:1.** Every row, every column, byte-restorable. `--skip-extended-insert`
  (one `INSERT` per row) + runtime `--default-character-set=<actual>` (no utf8mb4
  assumption) preserve `response_raw` (longText) and `json` payloads byte-for-byte.
- **Exact completeness, no tolerance.** `complete:true` requires every planned PK
  range verified, ranges partitioning `[min_id, max_id_frozen]` with no gap/overlap,
  and `sum(chunk.rows) == reconciled_count == COUNT(*) WHERE id BETWEEN min_id AND
  max_id_frozen` EXACTLY.
- **Frozen bounds.** `min_id`/`max_id_frozen` sampled once at run start; rows with
  `id > max_id_frozen` are reported as `rows_arrived_during_run`, never dropped,
  never folded into `total_rows`.
- **Append-only is a gate.** `COUNT(*) WHERE updated_at <> created_at` > 0 aborts
  (exit 4) unless `--allow-eventual` (which stamps `consistency:"eventual"`).
- **Never hangs.** Per-chunk subprocess timeout + global `RUN_DEADLINE` + stall rule.
- **PII never enters git.** The run dir (chunks + manifest + temp creds file) is
  gitignored; secrets never on argv/logs.
- Exit-code contract: `0` ok · `2` connection/cred-fetch · `3` tunnel unrecoverable
  / real query error · `4` append-only precondition failed · `5` run deadline ·
  `6` completeness shortfall (ran to the end, `complete:false`).

---

## SCEN-001: happy-path full extraction

**Given**: the driver runs against prod legacy off-hours, the append-only
precondition holds, and the table has ~657,984 rows.
**When**: the operator runs `python scripts/migration/extract-log-veh.py`.
**Then**: every PK range in `[min_id, max_id_frozen]` is dumped to a verified
`chunk-NNNNN-<lo>-<hi>.sql.gz`; the manifest is `complete:true` with
`total_rows == reconciled_count == COUNT(*) WHERE id BETWEEN min_id AND
max_id_frozen` EXACTLY (no tolerance); exit 0.
**Evidence**: `echo $?` → `0`; manifest `complete:true`; `total_rows` equals the
live `COUNT(*)` over the frozen range; every chunk `gzip -t` passes; numbers
transcribed into the run-summary.

---

## SCEN-002: resume skips verified chunks

**Given**: a prior run produced some `status:"verified"` chunks in the manifest.
**When**: the driver is re-invoked.
**Then**: only the missing ranges are dumped; verified chunks are NOT re-dumped;
the final manifest is identical to an uninterrupted run.
**Evidence**: re-invocation logs skip a verified range; mtimes of verified chunk
files are unchanged; final manifest `complete:true` with the same `total_rows`.
Unit: `resume_skip(chunk, manifest)` returns True only for
`(range present + sha256 match + gzip -t ok + rows == range_count)`.

---

## SCEN-003: tunnel death mid-run → relaunch, no corruption

**Given**: a run is in progress and the SSH forwarder dies silently (process alive
or gone, forwarding dead).
**When**: the driver reaches the next chunk and probes the handshake.
**Then**: the probe detects the dead tunnel, the driver relaunches it (own SSH +
keepalives), and continues; no partial/corrupt chunk is ever recorded as verified.
**Evidence**: run log shows a relaunch event; the chunk in flight at the death is
re-dumped and verified; no `.partial` survives in the final dir. Unit:
`probe_handshake` returns False for a dead socket, True for a MariaDB greeting.

---

## SCEN-004: chunk integrity + empty-range guard

**Given**: a produced chunk is truncated/corrupt, OR a PK range is genuinely empty
(a historical-prune gap).
**When**: the driver verifies the chunk.
**Then**: a corrupt chunk fails `gzip -t` or `rows != range_count` and is NOT
marked verified (retried); a 0-row chunk is marked verified ONLY when
`range_count == 0` too (distinguishes an empty range from a silently-failed dump).
**Evidence**: unit — a gz fixture whose text field contains `),(` and a quoted
`INSERT INTO` substring still counts the exact row count (`count_insert_rows`
counts statements, not tuples/substrings); a truncated gz fails `gzip_ok`; a
0-row chunk with `range_count>0` is rejected.

---

## SCEN-005a: byte fidelity (round-trip)

**Given**: a produced chunk and a scratch MariaDB.
**When**: the chunk is restored and sampled rows compared to source.
**Then**: rows reproduce byte-for-byte — `SHA2(response_raw)` and
`SHA2(processed_data)` match source-vs-restored, including a row with
multibyte/4-byte content.
**Evidence**: restore a sampled chunk; `SELECT SHA2(response_raw,256)` on the same
ids source vs restored are equal for the sampled set (incl. the multibyte row);
documented in the run-summary.

---

## SCEN-005b: non-blocking (no locking statements)

**Given**: the dump invocation.
**When**: the statements `mysqldump` actually emits are captured (general_log on a
scratch instance) and the source is observed during a chunk.
**Then**: no table-level `LOCK TABLES` or other blocking statement is issued
(`--single-transaction --quick --skip-lock-tables`); the source is never blocked.
**Evidence**: the captured statement stream contains `START TRANSACTION WITH
CONSISTENT SNAPSHOT` and `SELECT`s but no `LOCK TABLES`; asserted from emitted SQL,
not inferred from flags.

---

## SCEN-006: PII / secrets hygiene

**Given**: a completed (or in-progress) run.
**When**: git ignore status and logs are inspected.
**Then**: `git check-ignore -v` matches every artifact under
`docs/migration-runs/log-veh-extract-*/` (chunks, `.partial`, `manifest.json`, the
temp creds file); `git status --porcelain` of that path shows zero tracked files;
no DB password appears in `ps`/argv; the fetched `.env` blob and any `source_ip`
value never appear in logs/status; the manifest holds only metadata.
**Evidence**: `git check-ignore -v <chunk path>` returns a matching rule;
`git status --porcelain docs/migration-runs/log-veh-extract-*/` is empty of tracked
files; `ps`/argv during a dump shows no `-p<pass>`.

---

## SCEN-007: completeness — no silent gaps, late arrivals audited

**Given**: a run over the frozen `[min_id, max_id_frozen]`.
**When**: the final completeness verdict is computed.
**Then**: PK ranges partition `[min_id, max_id_frozen]` with no gap/overlap; a
deliberately removed range makes the verdict `complete:false` and exit non-zero
rather than claim success; rows inserted after `max_id_frozen` appear as
`rows_arrived_during_run`, never silently dropped nor folded into `total_rows`.
**Evidence**: unit — dropping a planned range → `complete:false`; an overlap →
rejected; `sum(rows) != reconciled_count` → `complete:false`; an id beyond
`max_id_frozen` lands only in `rows_arrived_during_run`.

---

## SCEN-008: credential + tunnel provisioning + teardown

**Given**: no operator-run tunnel exists and creds live only in the EC2 Laravel
`.env` (sudo-readable).
**When**: the driver starts and finishes.
**Then**: it fetches creds via `ssh rentacar 'sudo cat /home/rentacar/.env'`
(extracting only the 5 `DB_*` keys), brings up the tunnel itself, runs, and on exit
tears down the tunnel it created; a pre-existing operator tunnel would be left
running.
**Evidence**: the creds reach `mysqldump` only via a `0600 --defaults-extra-file`
(never argv); after a driver-created run the forwarder PID is gone; a simulated
pre-existing tunnel is left alive (teardown keyed on `created_by_us`).

---

## SCEN-009: append-only precondition gate

**Given**: the source where `COUNT(*) WHERE updated_at <> created_at` may be 0 or
greater.
**When**: the driver runs the precondition before any dump.
**Then**: if 0, the run proceeds and the manifest records
`consistency:"point-in-time"`; if > 0, the default run aborts (exit 4) before
dumping; with `--allow-eventual` it proceeds and records `consistency:"eventual"`.
**Evidence**: unit — the gate decision function returns proceed/abort/eventual for
inputs `0` / `>0` / `>0 + flag`; the live query runs in the real run.
