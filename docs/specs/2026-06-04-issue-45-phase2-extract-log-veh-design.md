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
| `source_ip` | ipAddress NULL | **PII** |
| `created_at` | timestamp NOT NULL | |
| `updated_at` | timestamp NOT NULL | |

**Append-only assumption:** these are write-once request/response logs; with the
prune disabled there are no deletes, and rows are not updated after insert (to be
verified at runtime: `COUNT(*) WHERE updated_at <> created_at` ≈ 0). This is the
property that makes per-chunk snapshots consistent without a global snapshot.

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
for each [lo, hi] PK window of size CHUNK_ROWS:
    if chunk already present AND verified in manifest: skip      # resume
    mysqldump --single-transaction --quick --no-tablespaces \
              --skip-lock-tables --hex-blob \
              --where="id BETWEEN lo AND hi" DB TABLE \
        | gzip > chunk-NNNNN-<lo>-<hi>.sql.gz.partial
    gzip -t                                                       # integrity
    rows_in_chunk == COUNT(*) WHERE id BETWEEN lo AND hi          # completeness
    sha256, atomic rename .partial -> final, append to manifest
verify: ranges cover [min_id, max_id] with no gaps; sum(rows) == COUNT(*)
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
3. **Fidelity.** `mysqldump` SQL restores 1:1 into a MariaDB; `--hex-blob` keeps
   `longText`/binary-ish content lossless; version-matched client (10.11.14)
   vs server (10.11.15).

### Why NOT a server-side `max_statement_time` kill-switch here

Phase 1's kill-switch protected *diagnostic* queries that must never run long.
The dump is intentionally long; a statement timeout would abort it. Non-blocking
is instead guaranteed structurally: no locks (InnoDB MVCC under
`--single-transaction`), short per-chunk transactions, off-hours, append-only data.

### Chunk sizing

`CHUNK_ROWS` configurable (default 25,000). At ~46 KB/row that is ~1.1 GiB raw →
~150–230 MB gzipped per chunk, ~27 chunks. Smaller chunks = finer resume
granularity + shorter transactions at the cost of more files. Ranges are computed
from the live `MIN(id)`/`MAX(id)` so gaps in the id sequence (from the historical
prune that ran before it was disabled) cost nothing — empty ranges produce a
0-row chunk that is recorded and skipped, never an error.

---

## 4. Autonomy — the driver owns its dependencies

Verified during brainstorming (2026-06-04): non-interactive SSH to `rentacar`
works (`BatchMode=yes`, no passphrase), and `sudo -n` is passwordless. The app
runs as user `rentacar` under `/home/rentacar/` (nginx root
`/home/rentacar/public_html/`), readable only via sudo.

The driver therefore provisions everything itself, no human input mid-run:

1. **Credentials.** `ssh rentacar 'sudo cat /home/rentacar/.env'`, parse
   `DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD`. Held in memory / a
   gitignored local `.env` only; never printed, never committed.
2. **Tunnel ownership.** The driver launches
   `ssh -fN -o ServerAliveInterval=30 -o ServerAliveCountMax=3
   -o ExitOnForwardFailure=yes -L 3307:<DB_HOST>:3306 rentacar`. Before every
   chunk it probes the raw MySQL handshake on `127.0.0.1:3307`; if dead it kills
   the stale forwarder and relaunches. `LEGACY_DB_HOST=127.0.0.1` forces TCP
   (avoids the `localhost`→Unix-socket bypass from Phase 1).
3. **Background + monitoring.** The driver runs detached; it reports progress to a
   status file (chunks done / total, bytes, current id) and re-invokes the agent
   on completion. The agent schedules wakeups to watch progress over ~2 h.
4. **Teardown.** On completion (or fatal abort) the driver tears down the tunnel
   it created. A tunnel that pre-existed (operator-run) is left untouched.

These connection facts and gotchas are captured in
[[reference_legacy_db_ssh_tunnel_access]].

---

## 5. Output

A single gitignored run directory (PII-bearing — never committed, like the ETL
backups):

```
docs/migration-runs/log-veh-extract-<UTC-stamp>/
  chunk-00001-<lo>-<hi>.sql.gz
  chunk-00002-<lo>-<hi>.sql.gz
  ...
  manifest.json
```

`manifest.json` (PII-free itself — metadata only, so it may be inspected/kept):

```json
{
  "table": "log_veh_available_rates_queries",
  "schema": "<db>",
  "generated_at": "<UTC>",
  "source_version": "10.11.15-MariaDB",
  "min_id": 22730, "max_id": 686855,
  "chunk_rows": 25000,
  "expected_rows_approx": 657984,
  "chunks": [
    {"seq": 1, "id_lo": 22730, "id_hi": 47729, "rows": 24930,
     "bytes_gz": 161203712, "sha256": "...", "status": "verified"}
  ],
  "total_rows": 657112,
  "complete": true,
  "append_only_check": {"rows_updated_after_insert": 0}
}
```

The operator moves this directory to durable secure storage afterward (out of
scope here).

---

## 6. Error handling

- **Credential fetch fails** (ssh/sudo) → abort before any dump, exit 2, no tunnel
  left running.
- **Tunnel cannot be (re)established** after N relaunch attempts → abort, exit 3,
  partial verified chunks preserved for resume.
- **Chunk dump fails** (`mysqldump` non-zero) or **`gzip -t` fails** or
  **row-count mismatch** → the `.partial` is discarded, the chunk is retried with
  backoff up to M times; if still failing, abort with the failing range recorded
  so a later resume retries exactly that range. Never mark a bad chunk verified.
- **Mid-run interruption** (kill / crash / wake) → re-invocation reads the manifest
  and resumes; verified chunks are skipped by `(range present + sha256 + gzip -t)`.
- **Completeness gap** at the end (a range missing or `sum(rows)` below
  `COUNT(*)` beyond tolerance) → `complete:false`, loud report, non-zero exit; a
  silent "done" with missing data is the prime failure to avoid.
- All errors mask the host and never print credentials.

---

## 7. Observable scenarios (bridge to SDD)

- **SCEN-001 happy path:** driver runs end-to-end against prod legacy → every PK
  range dumped, each `gzip -t` ok, manifest `complete:true`, `total_rows` within
  tolerance of `COUNT(*)`, exit 0.
- **SCEN-002 resume:** with some chunks already verified, a re-invocation dumps
  only the missing ranges and reaches the identical final manifest; verified
  chunks are not re-dumped.
- **SCEN-003 tunnel death mid-run:** the forwarder is killed between chunks; the
  driver's pre-chunk handshake probe detects it, relaunches the tunnel, and
  continues — no corrupt chunk is recorded.
- **SCEN-004 chunk integrity:** a truncated/corrupt chunk fails `gzip -t` (or
  row-count) → it is not marked verified; a retry re-produces a valid chunk.
- **SCEN-005 fidelity + non-blocking:** restoring a produced chunk into a scratch
  MariaDB reproduces its rows 1:1 (round-trip byte fidelity incl. `response_raw`);
  the dump issues no locking statements (`--single-transaction --quick
  --skip-lock-tables`).
- **SCEN-006 PII / secrets hygiene:** the run directory is gitignored and never
  committed; no credential or `source_ip` value is printed to logs/status; the
  manifest contains only metadata.
- **SCEN-007 completeness, no silent gaps:** PK ranges cover `[min_id, max_id]`
  with no gap; a deliberately removed range makes the final verify report
  `complete:false` and exit non-zero rather than claim success.
- **SCEN-008 credential + tunnel provisioning:** the driver obtains creds via
  `sudo cat` over SSH, brings up the tunnel itself, and tears down the tunnel it
  created on exit (a pre-existing operator tunnel is left running).

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
- `.gitignore` — ensure `docs/migration-runs/log-veh-extract-*/` is ignored
  (the `docs/migration-runs/` tree is already gitignored from Phase 1).

Unit surface (deterministic, no DB): PK-range planning, manifest read/merge,
resume-skip decision, gap/completeness verdict, host masking, status-file shaping.
DB-interaction surface (real mysqldump through the tunnel, the real archive) is
validated by execution and documented in a run-summary under
`docs/data-ops/2026-06-04-issue-45-phase2-extract-log-veh/`.
