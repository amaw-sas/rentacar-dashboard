# log_veh Phase 3 — exploratory analysis pipeline

Reproducible, deterministic, **PII-free** SQL pipeline over the Phase 2 archive of
`log_veh_available_rates_queries` (664,126 rows, 27 gzipped `mysqldump` chunks). Loads the
archive into a **throwaway** MariaDB sandbox, materializes two helper tables, runs the 11
analysis cuts, and tears the sandbox down. Issue #45 Phase 3.

## What it produces

- PII-free aggregate query output in `/tmp` (transcribed into the committed report).
- No persistent dataset, no write to `public.search_logs`, no write to the legacy source.

## Run it

```bash
# one entry point: provision -> load+reconcile -> materialize -> queries -> teardown
bash scripts/analysis/log-veh/run-analysis.sh
# prints the /tmp results path on completion
```

Stage scripts (composed by `run-analysis.sh`, also runnable standalone):

| Script | Stage |
|---|---|
| `provision-db.sh` | preflight (binaries + ≥60 GiB free) + start socket-only `mariadbd` |
| `load-archive.sh` | load the 27 chunks (footgun-safe) + reconcile to the manifest total |
| `materialize.sql` | build `search_flat` (1 row/search) + `cat_quotes` (exploded categories) |
| `analysis-queries.sql` | the 11 cuts, each with explicit denominator + deterministic ORDER BY |
| `check-pii.sh` | SCEN-003 gate: 0 IPv4/IPv6/email in the report, no `response_raw`, `source_ip` only aggregated. Run as the final stage of `run-analysis.sh` (fails the run on any violation) and standalone before commit. |
| `teardown.sh` | `mariadb-admin shutdown` + `find -delete` the datadir (no `kill`, no `rm -rf`) |
| `run-analysis.sh` | orchestrator |

### Useful env knobs

- `ARCHIVE_DIR` — where the 27 chunks + `manifest.json` live (default: Phase 2 worktree).
- `DATADIR` / `SOCKET` — throwaway datadir + Unix socket (default under `/tmp`).
- `MAX_CHUNKS=N` — load only the first N chunks (smoke test); reconcile target auto-adjusts
  to the manifest sum of those chunks.
- `EXPECTED_ROWS=N` — override the reconcile target explicitly.
- `KEEP_DB=1` — skip teardown (debugging only).

## Where the archive lives

`.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended/`
— 27 `chunk-NNNNN-<lo>-<hi>.sql.gz` + `manifest.json`. **Gitignored, carries PII**
(`response_raw` raw SOAP XML, `source_ip`). Read-only input here.

## The load footgun (why load-archive.sh is not a naive `cat | mysql`)

Every chunk — not just chunk 1 — begins with `DROP TABLE IF EXISTS` + `CREATE TABLE` +
`LOCK TABLES`. A naive sequential load would have each chunk **drop the table and wipe the
prior chunks**, leaving only the last chunk's rows.

Strategy:
- **Chunk 1** loads in full — its `DROP`+`CREATE` builds the table and inserts its 25,000 rows.
- **Chunks 2–27** load **INSERT-only**: `zcat chunkN.sql.gz | grep '^INSERT INTO' | mariadb`,
  which appends without re-running the `DROP`.

`mysqldump --skip-extended-insert` emits exactly one `INSERT INTO` per data row, so the
`grep` extracts precisely the data rows. `set -o pipefail` + per-chunk exit checks abort on
the first failure. Independently verifiable: `grep -c '^INSERT INTO'` over all 27 chunks ==
664,126, and the post-load `COUNT(*)` must equal `manifest.json:total_rows` or the run aborts
before any analysis.

## PII discipline

- The loaded DB **does** contain PII (`response_raw`, `source_ip`) — it is a disposable
  sandbox in `/tmp`, socket-only (no TCP), deleted by `teardown.sh` on completion.
- The committed SQL **never reads `response_raw`** and uses `source_ip` **only** as
  `COUNT(DISTINCT source_ip)` — values never reach output. This query-construction
  discipline is the primary control.
- `check-pii.sh` is the defense-in-depth backstop: greps the report (and the run's results
  file) for IPv4/IPv6/email value patterns (must be 0) and asserts `response_raw` is absent +
  `source_ip` aggregate-only in the SQL. It cannot enumerate every free-form PII shape that
  `response_raw` could carry (names, document ids) — that is why the query-construction
  discipline above, not this grep, is the real guarantee.

## Disposability

The datadir is a throwaway under `/tmp` (default `/tmp/log-veh-analysis-db/`), chosen over an
in-repo path because it is outside git entirely — it cannot be committed by accident. The
full uncompressed load (~18–20 GiB + InnoDB overhead) fits in the ~930 GiB free; `teardown.sh`
deletes it on completion and on failure paths. The one case it will not delete is if the
server refuses to shut down within the wait window — it aborts rather than delete a datadir
out from under a live `mariadbd`; re-run teardown once the server is down.

## Median note (cut #11)

MariaDB 10.11 has no `MEDIAN` aggregate; cut #11 uses
`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_amount) OVER (PARTITION BY category_code)`,
the supported equivalent, alongside `AVG`/`MIN`/`MAX`.
