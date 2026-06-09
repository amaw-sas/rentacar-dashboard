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

---

# Phase 3.5 — persistent Parquet snapshot + formal reports (issue #45)

Phase 3 ran one-shot SQL over a throwaway MariaDB that takes ~20 min to rebuild from the
6.8 GiB archive. Phase 3.5 makes the analytical dataset **persistent and instant**: it
exports the two PII-free materialized tables to a compact **Parquet snapshot** queryable
with DuckDB alone (no MariaDB, no raw archive), then renders **4 formal reports** into a
committed PII-free markdown bundle.

Why Parquet (not Postgres / `public.search_logs`): the legacy `log_veh` data is lossy
against the live `search_logs` schema (no franchise / referral / conversion) — the issue
forbids writing it there — and the consumer is **offline/ad-hoc**. `cat_quotes` is also the
only clean historical corpus of quoted prices (`search_logs` stores none), so it is worth
persisting compactly. Parquet is tool-agnostic (DuckDB / pandas / polars) and future-proof.

## Pipeline (build once, then query instantly)

```bash
# 1. Build the materialized tables (Phase 3 stages), then export to Parquet:
bash scripts/analysis/log-veh/provision-db.sh
bash scripts/analysis/log-veh/load-archive.sh          # 27 chunks -> 664,126 rows
mariadb --socket=/tmp/log-veh-analysis-db/mysqld.sock analysis \
  < scripts/analysis/log-veh/materialize.sql
bash scripts/analysis/log-veh/export-dataset.sh        # -> dataset/{search_flat,cat_quotes}.parquet
bash scripts/analysis/log-veh/teardown.sh              # MariaDB no longer needed

# 2. Generate the committed report bundle from the Parquet (no MariaDB):
bash scripts/analysis/log-veh/generate-reports.sh

# 3. PII gate over the committed artifacts (defaults cover the new bundle + reports/*.sql):
bash scripts/analysis/log-veh/check-pii.sh
```

| Script / file | Stage |
|---|---|
| `export-dataset.sh` | export `search_flat` + `cat_quotes` to `dataset/*.parquet`. PRIMARY: DuckDB `ATTACH … TYPE mysql` over the socket + `COPY … TO … (FORMAT parquet)`. FALLBACK: `mariadb --batch` TSV → DuckDB `read_csv` with pinned `nullstr='\N'` + explicit `DECIMAL(16,2)` (so the fallback is type-identical, not DOUBLE-coerced). Then the **allowlist schema assertion** — each Parquet's column set must equal exactly its expected list, else abort. |
| `reports/01-demand-by-branch-month.sql` | searches by pickup branch × month + top routes |
| `reports/02-pricing-by-category-season.sql` | median/avg/p25/p75 `total_amount` per category × month — the price corpus |
| `reports/03-quote-failure-rate.sql` | pd_kind share + error-code breakdown + error rate by branch × month |
| `reports/04-availability-and-behavior.sql` | availability per category + lead-time / duration / one-way-vs-round-trip buckets |
| `generate-reports.sh` | run the 4 reports over the Parquet → assemble the dated markdown bundle; abort on missing Parquet or report error |
| `query-examples.sql` | copy-paste DuckDB snippets for ad-hoc Parquet querying |

### Ad-hoc querying

Once `dataset/*.parquet` exists, query it directly — no MariaDB, no archive:

```bash
duckdb -c "SELECT COUNT(*) FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet';"
# or paste a snippet from query-examples.sql into an interactive `duckdb` shell
```

The `reports/*.sql` resolve the snapshot via a `dataset_dir` DuckDB variable
(`generate-reports.sh` sets it with `-c "SET VARIABLE dataset_dir='…'"`); standalone they
self-default to `scripts/analysis/log-veh/dataset`.

## Persistence & safe-copy note

- **Committed and durable:** the scripts, the 4 report SQL, and the **report bundle**
  (`docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md`).
  The findings survive in git even if the Parquet and the 6.8 GiB archive are deleted.
- **Gitignored and regenerable:** the two `dataset/*.parquet` files (the data-artifact
  preference keeps data out of git). Regenerating them requires the Phase 2 archive
  (preserved in its worktree) + a full pipeline run; the only alternative is a full Phase 2
  re-extract from the legacy DB. **Keep one manual copy of the ~30–55 MB Parquet somewhere
  safe** — it is the cheap insurance against both regeneration paths.

## PII boundary (Phase 3.5)

- The export selects only `search_flat` (which has **no** `source_ip` column) and
  `cat_quotes` (no PII columns); `response_raw` is never touched. The Parquet is PII-free.
- The **allowlist** schema assertion in `export-dataset.sh` rejects any unexpected column —
  not just `source_ip`/`response_raw`, but any future addition that could carry signal.
- The report bundle is aggregates only. `check-pii.sh` (defaults extended) scans it +
  `reports/*.sql` for IPv4/IPv6/email = 0 and `response_raw` absence.
