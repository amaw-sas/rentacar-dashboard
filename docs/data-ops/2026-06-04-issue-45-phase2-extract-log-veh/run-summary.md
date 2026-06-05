# Run summary — Issue #45 Phase 2: raw extraction of legacy `log_veh`

**Status:** COMPLETE — autonomous run finished 2026-06-05.
**Driver:** `scripts/migration/extract-log-veh.py` + `scripts/migration/_tunnel.py`
**Scenarios:** `docs/specs/2026-06-04-issue-45-phase2-extract-log-veh/scenarios/extract-log-veh.scenarios.md`

A faithful 1:1 dump of `log_veh_available_rates_queries` (legacy MariaDB 10.11.15,
behind RDS), decoupled from the productive ETL: this table never lands in
`public.search_logs`. The run was read-only on the source, ran in a single
unattended pass, and the driver owned its own SSH tunnel start to finish.

This doc carries ONLY PII-free numbers transcribed from the gitignored
`manifest.json`. The chunk files (`response_raw` + `source_ip`) and the manifest
itself stay local under `docs/migration-runs/log-veh-extract-unattended/` and are
never committed.

---

## Run metadata

| Field | Value |
|---|---|
| Finished (local) | 2026-06-05 09:28:57 -05 (started 08:40:16 → 48m41s) |
| `table_charset` (detected at runtime) | `utf8mb4` |
| `source_ip` storage type | `varchar(45)` |
| `min_id` | 22730 |
| `max_id_frozen` | 686855 |
| `rows_arrived_during_run` | 0 |
| `chunk_rows` | 25000 |
| `consistency` | point-in-time |
| `append_only_precondition.rows_updated_after_insert` | 0 |
| chunks produced | 27 (all `verified`) |
| `total_rows` | 664126 |
| `reconciled_count` | 664126 |
| `complete` | true |
| exit code | 0 |
| archive size | 6.8 GiB (7,262,938,922 bytes); gz per chunk 120–364 MiB |

The exact `COUNT(*)` completed here, unlike Phase 1: scoped to the frozen PK range
it rides the primary key, whereas the full-table count that once hung production had
no usable index.

## Scenario evidence

Fresh evidence, run against the real archive and the source, not read off the
driver's own flags.

**SCEN-001 / 004 / 007 — faithful completeness.** `gzip -t` across all 27 chunks: 0
failures. An independent `^INSERT INTO` count (decompressing all 27) returns
**664,126**, matching `total_rows`, `reconciled_count`, and the sum of `chunk.rows`.
The PK ranges partition `[min_id, max_id_frozen]` with no gap or overlap; the first
`id_lo` equals `min_id` and the last `id_hi` equals `max_id_frozen`. A row past
`max_id_frozen` would have landed in `rows_arrived_during_run`, never in the total —
there were none.

**SCEN-005a — byte fidelity.** Chunk 1 was restored to an ephemeral MariaDB and
`SHA2(response_raw,256)` / `SHA2(processed_data,256)` compared source-vs-restored for
four sampled ids, including the chunk's most-multibyte row (`id` 38920, 553 bytes
beyond its character count). All eight hashes match exactly:

| id | SHA2(response_raw) | SHA2(processed_data) | LEN/CHAR |
|---|---|---|---|
| 22730 | `3d4456fd…3ca3` | `a7454e23…e995` | 59908/59746 |
| 35230 | `6f3ceed5…8678` | `63e0cfff…e579` | 50373/50217 |
| 38920 | `9a75b59c…9887` | `a09ac2c6…c189e` | 100830/100277 |
| 47729 | `2a60233a…5770` | `37eaa4b5…bb01` | 55531/55371 |

**SCEN-005b — non-blocking.** The statements `mysqldump` actually emits were captured
via `general_log` on the ephemeral instance. The stream carries
`SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ` and
`START TRANSACTION /*!40100 WITH CONSISTENT SNAPSHOT */`, plus the dump `SELECT`s. No
`LOCK TABLES` and no `FLUSH TABLES WITH READ LOCK` appear. The source is never blocked.

**SCEN-006 — PII / secret hygiene.** During an active dump the real `mysqldump` argv
carries no password (0 `-p`/`--password` tokens); the credential reaches it only via a
`0600 --defaults-extra-file`. The artifacts (chunks, `.partial`, `manifest.json`, the
temp creds file) are all matched by `.gitignore:90`
(`/docs/migration-runs/log-veh-extract-*/`); `git status --porcelain` of that path
shows nothing tracked. The manifest holds metadata only — no `source_ip`, no `.env`
blob in any log.

**SCEN-008 — credentials + tunnel.** The driver fetched the five `DB_*` keys via
`ssh rentacar 'sudo -n cat /home/rentacar/rentacar-admin/.env'`, discarding the rest of
the file. The `--defaults-extra-file` points at the local tunnel end
(`127.0.0.1:3307`), not the RDS endpoint. On exit the forwarder it created was gone
(no live `ssh -L 3307`).

**SCEN-009 — append-only gate.** The `updated_at <> created_at` count was 0, so the run
proceeded and the manifest recorded `consistency:"point-in-time"`. With mutated rows it
would have aborted at exit 4 unless `--allow-eventual`.

**SCEN-002 / 003 — resume + relaunch.** Not exercised live: the run was a single clean
pass and the tunnel stayed healthy. Both paths are covered by the committed unit tests
(`resume_skip`, `probe_handshake`, `relaunch_if_dead`).

## Archive location

`docs/migration-runs/log-veh-extract-unattended/` (gitignored): the 27
`chunk-NNNNN-<lo>-<hi>.sql.gz` files plus `manifest.json`. It is never committed — it
carries PII (`response_raw`, `source_ip`). The manifest is the reproducible source of
truth: ranges, counts, per-chunk sha256, the gate, and the verdict.

## Reproduce / restore

- **Resume / re-run:** `run-log-veh-extraction.sh` with its fixed `--run-dir` skips the
  chunks already `verified` (sha256 + `gzip -t` + `rows == range_count`) and dumps only
  what is missing. Idempotent.
- **Restore:** each chunk ships its own `CREATE TABLE`; loading one `.sql.gz` with
  `zcat | mariadb <db>` rebuilds the table and that PK range. For the full history,
  load all 27 in order into a clean database.
