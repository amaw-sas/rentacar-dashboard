# Design — Issue #45 Phase 2: faithful raw extraction of legacy `log_veh`

**Status:** approved (brainstorming 2026-06-04)
**Issue:** #45 (Phase 2 — extraction). Phase 1 (sizing) merged in PR #98.
**Scope:** extraction only. Parsing/analysis is a later, separate phase.

---

## 1. Goal

Produce a faithful, complete, 1:1 raw archive of the legacy table
`log_veh_available_rates_queries` (Aurora MariaDB 10.11.15, reached via SSH tunnel
through the EC2 `rentacar`). The archive is the durable input for the future
analysis module. It is **decoupled from the productive ETL (#19–#24)** and **never
writes to `public.search_logs`**.

"Faithful 1:1" means: every row, every column, byte-for-byte restorable into a
MariaDB. This includes the bulky `response_raw` (longText) and `source_ip`
(PII) — the dump is a complete backup, not an analytical reduction.

Phase 1 already answered the issue's open question: **the legacy prune does not
run.** The table holds ~657,984 rows / 28.7 GiB spanning 2024-05-27 → 2026-05-11
(~2 years of real historical depth), `avg_row_bytes ≈ 46 KB`. The size is
dominated by `response_raw`.

### Source table (from `docs/audit-workspace/01-legacy-schema-snapshot.md`)

| column | type | notes |
|---|---|---|
| `id` | bigint unsigned PK | AUTO_INCREMENT, contiguous-ish |
| `request_parameters` | json NOT NULL | 4 camelCase fields (locations + datetimes) |
| `response_status` | int NOT NULL | HTTP code |
| `response_raw` | longText NULL | raw API response — the bulk of the 28.7 GiB |
| `processed_data` | json NULL | parsed quotes per category, or error object |
| `source_ip` | Laravel `ipAddress` cast | **PII**; underlying storage type (varchar(45)/INET6) verified at runtime, noted in run-summary (M10) |
| `created_at` | timestamp NOT NULL | |
| `updated_at` | timestamp NOT NULL | |

The two column types and the table charset are not assumed — the driver reads
`SHOW CREATE TABLE` at run start and records them in the manifest.

**Append-only premise (enforced, not assumed):** these are write-once
request/response logs; with the prune disabled there are no deletes, and rows are
not updated after insert. This is what makes per-chunk snapshots consistent
without a global snapshot — so it is not a footnote but a **precondition gate**
(§6): the run measures `COUNT(*) WHERE updated_at <> created_at` before any dump
and aborts (exit 4) if non-zero, unless `--allow-eventual` is given (which stamps
`consistency:"eventual"`).

---

## 2. Non-goals

- No parsing of `request_parameters` / `processed_data` (later phase).
- No analytical metrics (volume distribution, error rate, top categories).
- No write to `public.search_logs` or any productive table.
- No transform/reduction/PII scrub of the raw bytes (this is a faithful backup).
- No decision on the final durable home of the archive (operator chooses where to
  store the produced files afterward).

---

## 3. Approach — chunked `mysqldump` by PK range (Approach B)

A single autonomous driver dumps the table in contiguous **primary-key ranges**,
one gzipped `mysqldump` SQL file per chunk, with a manifest.

```
# --- run start, ONCE (frozen for the whole run) ---
min_id      = SELECT MIN(id)
max_id_frozen = SELECT MAX(id)                 # frozen: rows inserted after this are NOT dumped
precondition: n = COUNT(*) WHERE updated_at <> created_at
              if n > 0 -> ABORT (exit 4) unless --allow-eventual given (see §6, I3)
charset     = real column charset from SHOW CREATE TABLE / information_schema  # do NOT assume utf8mb4
creds       -> written to a 0600 --defaults-extra-file inside the gitignored run dir (NEVER on argv)

# --- chunk loop over [min_id, max_id_frozen] ---
for each [lo, hi] PK window of size CHUNK_ROWS:
    if chunk present AND status=="verified" in manifest: skip            # resume
    ( mysqldump --defaults-extra-file=<tmp> --single-transaction --quick \
                --no-tablespaces --skip-lock-tables --hex-blob \
                --skip-extended-insert --default-character-set=<charset> \
                --where="id BETWEEN lo AND hi" DB TABLE \
        | gzip > chunk-NNNNN-<lo>-<hi>.sql.gz.partial )                  # under per-chunk watchdog (§4, I4)
    gzip -t                                                              # integrity
    # --skip-extended-insert => exactly ONE `INSERT INTO` statement per row, so the
    # row count is an unambiguous O(1)-memory line count, immune to `),(` appearing
    # inside response_raw (which would break any extended-insert tuple split) (N1):
    rows_in_chunk = count of lines matching ^INSERT INTO `TABLE` in the gunzip stream
    range_count   = COUNT(*) WHERE id BETWEEN lo AND hi
    assert rows_in_chunk == range_count                                 # EXACT, per range
    if rows_in_chunk == 0: assert range_count == 0                      # empty-range vs failed-dump (M9)
    sha256, atomic rename .partial -> final, append manifest entry status="verified"

# --- final completeness verdict: complete=true requires ALL of ---
(a) every planned range present AND status=="verified"
(b) ranges PARTITION [min_id, max_id_frozen] exactly: no gap, no overlap
(c) sum(chunk.rows) == COUNT(*) WHERE id BETWEEN min_id AND max_id_frozen   # EXACT, no "tolerance"
rows with id > max_id_frozen -> reported as rows_arrived_during_run, NEVER folded into total
```

### Why chunked (not a single dump)

1. **Resilience / autonomy.** The SSH tunnel died silently once in Phase 1
   (process alive, forwarding dead). A single 1–2 h dump that drops at 90 %
   restarts from zero. Chunks make the run resumable — a re-invocation skips
   verified chunks and continues. At most one in-flight chunk is ever lost.
2. **Non-blocking.** Each chunk is a short `--single-transaction` snapshot rather
   than one multi-hour read view. A 2 h-long view on the source could bloat the
   InnoDB undo log if any writes land; many short snapshots avoid that. Combined
   with off-hours execution and the low write volume of a phased-out legacy, the
   source is never blocked. `--quick` streams rows (mysql_use_result) so neither
   client nor server buffers the whole table — this is the exact failure mode
   (`SELECT *`) that crashed prod before.
3. **Fidelity.** `mysqldump` SQL restores 1:1 into a MariaDB. mysqldump runs
   **locally** and streams over the tunnel, so the local client version is what
   matters: compatible patch versions (local client 10.11.14, source server
   10.11.15). **Charset is the real fidelity risk, not blobs:** `--hex-blob` only
   affects BLOB/binary columns, but the bulk column `response_raw` is `longText`
   and the payloads are `json` — character types dumped as escaped string
   literals. Byte-faithfulness therefore depends on the connection charset
   matching the column charset. The driver reads the real column charset at
   runtime (`SHOW CREATE TABLE`) and passes `--default-character-set=<actual>`
   explicitly — it does NOT assume `utf8mb4`. `json` columns in MariaDB are
   `longtext` + a `json_valid()` CHECK; the round-trip claim is **byte-equality**
   of `response_raw`/`processed_data` (see SCEN-005a), not JSON re-canonicalization.

### Why NOT a server-side `max_statement_time` kill-switch here

Phase 1's kill-switch protected *diagnostic* queries that must never run long.
The dump is intentionally long; a statement timeout would abort it. Non-blocking
is instead guaranteed structurally: no locks (InnoDB MVCC under
`--single-transaction`), short per-chunk transactions, off-hours, append-only data.

### Chunk sizing

`CHUNK_ROWS` configurable (default 25,000). At ~46 KB/row that is ~1.1 GiB raw →
~150–230 MB gzipped per chunk, ~27 chunks. Smaller chunks = finer resume
granularity + shorter transactions at the cost of more files. Ranges are computed
once from the frozen `min_id`/`max_id_frozen` (sampled at run start, §3 pseudocode)
— never re-sampled mid-run, so the chunk plan is stable across resumes. Gaps in the
id sequence (from the historical prune that ran before it was disabled) cost
nothing: an empty range produces a 0-row chunk that is recorded as `rows:0` only
after confirming `COUNT(*)` for that range is also 0 (M9 guard — distinguishes a
real gap from a silently-failed dump that emitted DDL but no `INSERT`s).

---

## 4. Autonomy — the driver owns its dependencies

Verified during brainstorming (2026-06-04): non-interactive SSH to `rentacar`
works (`BatchMode=yes`, no passphrase), and `sudo -n` is passwordless. The app
runs as user `rentacar` under `/home/rentacar/` (nginx root
`/home/rentacar/public_html/`), readable only via sudo.

The driver therefore provisions everything itself, no human input mid-run:

1. **Credentials (no argv/log leak).** `ssh rentacar 'sudo cat /home/rentacar/.env'`
   returns the whole secrets file over stdout; the driver extracts only the 5
   `DB_*` keys and **discards the rest immediately** — the blob is never logged,
   never written whole. The password reaches `mysqldump` ONLY via a
   `--defaults-extra-file=<tmp>` written `0600` inside the gitignored run dir
   (or `MYSQL_PWD` env) — **never** as `-p<pass>` on argv (visible in `ps`). The
   temp creds file is `unlink`ed in a `finally`/`atexit`; on SIGKILL its residue
   stays inside the gitignored dir (documented, acceptable). The driver runs with
   `set +x`; no subprocess command line carrying a secret is ever echoed.
2. **Tunnel ownership.** The driver launches
   `ssh -fN -o ServerAliveInterval=30 -o ServerAliveCountMax=3
   -o ExitOnForwardFailure=yes -L 3307:<DB_HOST>:3306 rentacar`. Before every
   chunk it probes the raw MySQL handshake on `127.0.0.1:3307`; if dead it kills
   the stale forwarder and relaunches. `LEGACY_DB_HOST=127.0.0.1` forces TCP
   (avoids the `localhost`→Unix-socket bypass from Phase 1).
3. **Watchdog (never hangs).** Tunnel relaunches (N) and chunk retries (M) do not
   cover a `mysqldump` that connects then wedges mid-stream (half-dead tunnel: the
   pre-chunk handshake passed but the byte stream stalls — the process is "alive").
   So: (a) **per-chunk subprocess timeout** = `max(CHUNK_TIMEOUT_FLOOR,
   4× expected_chunk_seconds)`; on breach SIGKILL the dump, discard `.partial`,
   retry under M. (b) **global run deadline** `RUN_DEADLINE` (default 3 h); on
   breach the driver tears its tunnel down, preserves verified chunks, writes
   `complete:false`, exits 5. (c) **stall rule:** if the status file's
   `current_id`/`bytes` is unchanged for > `STALL_T` minutes, kill the in-flight
   chunk and treat it as a chunk failure.
4. **Background + monitoring.** The driver runs detached; it reports progress to a
   status file (chunks done / total, bytes, current id, last-advance timestamp) and
   re-invokes the agent on completion. The agent schedules wakeups to watch
   progress over ~2 h and enforces the stall rule above.
5. **Teardown.** On completion (or fatal abort/deadline) the driver tears down the
   tunnel it created. A tunnel that pre-existed (operator-run) is left untouched.

These connection facts and gotchas are captured in
[[reference_legacy_db_ssh_tunnel_access]].

---

## 5. Output

A single run directory whose **dump files are PII-bearing and must never be
committed** (`response_raw` + `source_ip`):

```
docs/migration-runs/log-veh-extract-<UTC-stamp>/
  chunk-00001-<lo>-<hi>.sql.gz
  chunk-00002-<lo>-<hi>.sql.gz
  ...
  manifest.json          # PII-free (metadata only) — kept LOCAL, not committed
```

**Gitignore is explicit, not inherited.** Phase 1's report sat directly in
`docs/migration-runs/` so the existing `*.json` rule ignored it; that rule does
NOT reach a nested `log-veh-extract-*/` subdir — verified: `git check-ignore`
returns nothing for the chunk path. The implementation MUST add a deterministic
rule. The chosen rule ignores the whole run dir (chunks AND manifest), and the
PII-free completeness numbers are transcribed into the committed run-summary
(Phase-1 pattern) — so nothing inside the PII dir is ever tracked:

```gitignore
# Issue #45 Phase 2 — legacy log_veh raw extraction (PII: response_raw + source_ip).
# Entire run dir is local-only; PII-free numbers live in the committed run-summary.
/docs/migration-runs/log-veh-extract-*/
```

`manifest.json` (metadata only — PII-free; lives locally + its key numbers are
copied into the run-summary):

```json
{
  "table": "log_veh_available_rates_queries",
  "schema": "<db>",
  "generated_at": "<UTC>",
  "source_version": "10.11.15-MariaDB",
  "table_charset": "<verified>",
  "min_id": 22730,
  "max_id_frozen": 686855,
  "max_id_at_completion": 686903,
  "rows_arrived_during_run": 48,
  "chunk_rows": 25000,
  "expected_rows_approx": 657984,
  "_comment_expected_rows_approx": "Phase-1 sizing ESTIMATE only — NOT part of the complete:true gate; only total_rows == reconciled_count matters",
  "append_only_precondition": {"rows_updated_after_insert": 0},
  "consistency": "point-in-time",
  "chunks": [
    {"seq": 1, "id_lo": 22730, "id_hi": 47729,
     "rows": 24930, "range_count": 24930,
     "bytes_gz": 161203712, "sha256": "...", "status": "verified"}
  ],
  "total_rows": 657984,
  "reconciled_count": 657984,
  "complete": true
}
```

`total_rows` (sum of chunk rows) MUST equal `reconciled_count`
(`COUNT(*) WHERE id BETWEEN min_id AND max_id_frozen`) exactly for `complete:true`
— there is no tolerance band (I2). `max_id_at_completion`/`rows_arrived_during_run`
make late arrivals auditable rather than silently dropped (I3/M11). The operator
moves this directory to durable secure storage afterward (out of scope here).

---

## 6. Error handling

- **Append-only precondition gate** (run start, before any dump): if
  `COUNT(*) WHERE updated_at <> created_at` > 0 the per-chunk-snapshot consistency
  premise is violated. Default: **abort, exit 4**, loud warning. With an explicit
  `--allow-eventual` flag the run proceeds but stamps the manifest
  `consistency:"eventual"` so the archive is never silently presented as
  point-in-time.
- **Credential fetch fails** (ssh/sudo) → abort before any dump, exit 2, no tunnel
  left running, no creds file written.
- **Tunnel cannot be (re)established** after N relaunch attempts → abort, exit 3,
  partial verified chunks preserved for resume.
- **Chunk dump fails** (`mysqldump` non-zero), **`gzip -t` fails**, **per-chunk
  watchdog timeout / stall** (SIGKILL), or **`rows_in_chunk != range_count`** →
  the `.partial` is discarded, the chunk is retried with backoff up to M times; if
  still failing, abort with the failing range recorded so a later resume retries
  exactly that range. Never mark a bad chunk verified.
- **Global run deadline** `RUN_DEADLINE` breached → tear down the driver's tunnel,
  preserve verified chunks, write `complete:false`, exit 5 (resumable).
- **Mid-run interruption** (kill / crash / wake) → re-invocation reads the manifest
  and resumes; a chunk counts as verified only by
  `(range present + sha256 match + gzip -t ok + rows == range_count)`. The manifest
  is the **sole source of verified-ness** (the recorded sha256 is what "match" is
  against). If the manifest is absent or corrupt, resume treats **no** chunk as
  verified and cold-starts — every range is re-dumped via `.partial` + atomic
  rename (safe overwrite). No chunk is ever trusted on `gzip -t`/presence alone
  without its manifest sha256 (N2).
- **Completeness verdict** (end of run): `complete:true` requires the exact
  three-part reconciliation in §3 (all ranges verified · partition with no
  gap/overlap · `sum(rows) == reconciled_count` EXACTLY). Any shortfall →
  `complete:false`, loud report, non-zero exit. A silent "done" with missing data
  is the prime failure to avoid; there is no tolerance band that could mask it.
- All errors mask the host and never print credentials or the fetched `.env` blob.

---

## 7. Observable scenarios (bridge to SDD)

- **SCEN-001 happy path:** driver runs end-to-end against prod legacy → every PK
  range dumped, each `gzip -t` ok, manifest `complete:true`, and
  `total_rows == reconciled_count == COUNT(*) WHERE id BETWEEN min_id AND
  max_id_frozen` EXACTLY (no tolerance), exit 0.
- **SCEN-002 resume:** with some chunks already verified, a re-invocation dumps
  only the missing ranges and reaches the identical final manifest; verified
  chunks are not re-dumped.
- **SCEN-003 tunnel death mid-run:** the forwarder is killed between chunks; the
  driver's pre-chunk handshake probe detects it, relaunches the tunnel, and
  continues — no corrupt chunk is recorded.
- **SCEN-004 chunk integrity:** a truncated/corrupt chunk fails `gzip -t` (or
  `rows != range_count`) → it is not marked verified; a retry re-produces a valid
  chunk. A 0-row chunk is marked verified ONLY when `range_count == 0` too (M9).
- **SCEN-005a byte fidelity:** restoring a produced chunk into a scratch MariaDB
  reproduces rows byte-for-byte — verified by `SHA2(response_raw)` /
  `SHA2(processed_data)` source-vs-restored on sampled rows including one with
  multibyte / 4-byte content (not mere row presence).
- **SCEN-005b non-blocking:** the statements `mysqldump` actually emits (captured
  via `general_log` on a scratch instance) contain no table-level `LOCK TABLES` or
  other blocking statement — asserted from emitted SQL, not inferred from flags.
- **SCEN-006 PII / secrets hygiene:** `git check-ignore -v` returns a matching rule
  for the produced chunk dir, and `git status --porcelain
  docs/migration-runs/log-veh-extract-*/` shows zero tracked files; no DB password
  appears in `ps`/argv; the fetched `.env` blob and `source_ip` values never appear
  in logs/status; the manifest contains only metadata.
- **SCEN-007 completeness, no silent gaps:** PK ranges partition
  `[min_id, max_id_frozen]` with no gap/overlap; a deliberately removed range makes
  the final verify report `complete:false` and exit non-zero rather than claim
  success; rows inserted after `max_id_frozen` appear as `rows_arrived_during_run`,
  never silently dropped nor folded into `total_rows`.
- **SCEN-008 credential + tunnel provisioning:** the driver obtains creds via
  `sudo cat` over SSH, brings up the tunnel itself, and tears down the tunnel it
  created on exit (a pre-existing operator tunnel is left running).
- **SCEN-009 append-only precondition:** when
  `COUNT(*) WHERE updated_at <> created_at` > 0, the default run aborts (exit 4)
  before dumping; with `--allow-eventual` it proceeds and the manifest records
  `consistency:"eventual"`.

---

## 8. File map (for planning)

- `scripts/migration/extract-log-veh.py` — the autonomous driver (chunk loop,
  manifest, verify, resume).
- `scripts/migration/_tunnel.py` (or inline) — tunnel ownership: launch, handshake
  probe, relaunch, teardown. May be reused by future legacy runs.
- `scripts/migration/test_extract_log_veh.py` — unit tests for the pure functions
  (range planning, manifest merge/resume, completeness/gap check, status shaping)
  on bare Python (no pymysql / no mysqldump).
- `scripts/migration/README.md` — append a Phase-2 operation section.
- `.gitignore` — add `/docs/migration-runs/log-veh-extract-*/` (NOT inherited from
  Phase 1 — the existing rules only reach files directly in `docs/migration-runs/`,
  not this subdir; verified via `git check-ignore`). First implementation step,
  gated by a test asserting `git check-ignore` matches a sample chunk path (B1).

Unit surface (deterministic, no DB / no mysqldump): PK-range planning over a frozen
`[min_id, max_id_frozen]`, manifest read/merge + resume-skip decision, the exact
three-part completeness verdict (all-verified · partition no-gap/no-overlap ·
`sum(rows) == reconciled_count`), the empty-range vs failed-dump guard (rows==0 ⇒
range_count==0), late-arrival accounting (`rows_arrived_during_run`), host masking,
credentials never on argv (build `--defaults-extra-file` content), status-file
shaping. DB-interaction surface (real `mysqldump` through the tunnel, charset
detection, the append-only precondition query, the real archive + byte-fidelity
round-trip) is validated by execution and documented in a run-summary under
`docs/data-ops/2026-06-04-issue-45-phase2-extract-log-veh/`.
