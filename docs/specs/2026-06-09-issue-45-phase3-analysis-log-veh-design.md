# Issue #45 Phase 3 — Exploratory analysis of legacy `log_veh`

**Date:** 2026-06-09
**Branch:** `task/issue-45-phase3-analysis`
**Status:** Design — pending spec review + user approval
**Depends on:** Phase 2 extraction (PR #103, merge `03a19e2`) — the 6.8 GiB archive at
`.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended/`
(27 `chunk-NNNNN-<lo>-<hi>.sql.gz` + `manifest.json`, gitignored, carries PII).

---

## 1. Context

Issue #45 has two deliverables. Phase 2 delivered the first — a faithful 1:1 raw
extraction of `log_veh_available_rates_queries` (664,126 rows, ids 22730→686855,
point-in-time). This phase delivers the second: the **analysis** of that history,
explicitly framed by the issue as the input for a future analytics module — not
operational data, and never written to `public.search_logs`.

The extraction also answered the issue's open question: the legacy prune **never ran**
(ids start at 22730, multi-year history present), so there is real historical depth to
analyze.

The data is already in MariaDB-native dump format, so loading it into a local MariaDB is
the native restore — zero parsing loss — and SQL with JSON functions is the right tool
for the aggregations the issue requires.

## 2. Goals / Non-goals

**Goals**
- Produce a PII-free exploratory analysis report answering the issue's questions plus a
  curated set of cheap, high-value extra cuts.
- Keep the analysis reproducible: versioned SQL committed alongside the report.
- Maintain strict PII hygiene: the dump restores `response_raw` + `source_ip` (PII); the
  loaded database is a throwaway sandbox, deleted at the end; only PII-free aggregates are
  committed.

**Non-goals (YAGNI)**
- Building a persistent analytical dataset (Parquet / DuckDB file / Supabase analytical
  table). The issue defers the destination decision to "when the analytics module takes
  shape"; this phase only produces the exploratory report.
- Any write to `public.search_logs` or to the productive ETL (#19–#24).
- Any write to the legacy source (the archive is read-only here; the source DB is not
  touched at all in this phase).

## 3. Approach

Load the full archive into a dedicated throwaway MariaDB instance, materialize two helper
tables once (for query performance), run a versioned PII-free query file, and transcribe
the aggregates into a markdown report.

Rejected alternatives:
- **DuckDB over the `.gz` directly** — DuckDB does not read MySQL dump SQL natively;
  would require a CSV/Parquet conversion step and abandons the native-restore fidelity.
- **Query the raw JSON on every analysis query** — `JSON_TABLE` over 664,126 longtext
  rows repeated per query is slow. Materializing the explosion once is the performance
  fix; the helper tables live only inside the throwaway DB and are never a deliverable.

## 4. Pipeline

Deterministic, read-only on the archive, reproducible:

0. **Preflight.** Confirm the server binaries exist (`mariadbd`, `mariadb-install-db`) —
   the pipeline needs a local MariaDB *server*, not just the client — and that free disk
   on `/tmp` exceeds a floor (≥ 60 GiB). Abort early if either fails. (Verified at design
   time: both binaries present, ~930 GiB free.)
1. **Provision throwaway DB.** `mariadb-install-db` into a throwaway datadir; start
   `mariadbd` with a custom socket, **socket-only (skip-networking, no TCP)** so the PII
   is never reachable over the network.
2. **Load.** Restore each chunk **one at a time** in PK order (chunk 1 carries
   `CREATE TABLE`), checking the exit code of every chunk: `set -o pipefail` and
   `zcat <chunk> | mariadb …` per file, aborting on the first non-zero. A single globbed
   pipe would swallow mid-stream failures (only the last command's status survives), which
   would make the SCEN-1 gate untrustworthy. The table has only a PK (no secondary indexes
   / FKs), so load is straightforward.
3. **Reconcile load.** `SELECT COUNT(*)` must equal **664,126** (the manifest total). On
   mismatch the pipeline aborts — the analysis is only valid over the faithful full
   dataset.
4. **Materialize helpers** (internal to the throwaway DB, performance optimization):
   - `search_flat` — one row per search (so it always has exactly 664,126 rows) with
     extracted scalar columns: `id`, `pickup_location`, `return_location`, `pickup_dt`,
     `return_dt`, `created_at`, `response_status`, `pd_kind` (processed_data
     classification, see §6), `rp_kind` (request_parameters classification, see §6),
     `error_code`, `n_categories`.
   - `cat_quotes` — `processed_data` arrays exploded via `JSON_TABLE`, one row per
     `(search_id, category_code, total_amount, …)`; on the order of ~3M rows (the real run
     produced 2,974,126). **It spans
     only the `pd_kind = 'array'` subset** — error/malformed/null searches contribute no
     category rows. Any cut drawn from `cat_quotes` (§7 #5, #11) must state its denominator
     explicitly (see §7).
5. **Run analysis queries.** A versioned `analysis-queries.sql`, PII-free (never selects
   `response_raw`, never selects `source_ip` values — see §5).
6. **Transcribe report.** PII-free markdown aggregate report; user-facing prose passed
   through `/humanizer`; commit report + SQL.
7. **Teardown.** `mariadb-admin … shutdown` (no `kill`); delete the datadir with
   `find … -delete` (no `rm -rf`, per harness constraints).

**Throwaway datadir:** `/tmp/log-veh-analysis-db/`. `/tmp` is chosen over a
gitignored-in-repo path because it is strictly safer for PII — outside git entirely, so it
cannot be committed by accident — and still satisfies dedicated + disposable + deleted on
completion. The host has ~930 GiB free on that filesystem; the load (~18–20 GiB
uncompressed + InnoDB overhead) fits comfortably.

## 5. PII boundary (hard limit)

**Primary control (by construction):** `analysis-queries.sql` **never** references
`response_raw` and never selects `source_ip` *values* into any output. `source_ip` appears
only as an aggregate (e.g. `COUNT(DISTINCT source_ip)`), never the values themselves. This
query-construction discipline is the real guarantee — a generic regex cannot reliably
catch the free-form PII that `response_raw` may carry (names, phones, document ids), so the
boundary must hold at the query layer, not at a text filter.

**Defense-in-depth backstop (SCEN-3):** before commit, grep the report + SQL against a
pinned pattern floor — IPv4 (`\b\d{1,3}(\.\d{1,3}){3}\b`) and email
(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`) — and confirm the literal strings
`response_raw` and `source_ip` appear nowhere except as documented aggregate-column names.
Zero matches required. This is secondary to the query discipline above, not the primary
control.

- Location codes (Localiza branch codes) and category codes are **not PII** and are shown.
- The only committed artifacts are the report `.md` and the `.sql`; both PII-free. The
  datadir lives in `/tmp` and is deleted at the end.

## 6. Data quality handling

A serious analysis counts what it cannot parse rather than dropping it silently.

- `processed_data` values that are neither a valid array of quotes nor a valid error
  object (malformed / NULL / empty) are **classified and counted**, never silently
  dropped, never crash the pipeline. `search_flat.pd_kind ∈ {array, error, malformed,
  null}`. The distribution of `pd_kind` is itself a reported finding, and it always sums to
  664,126.
- `request_parameters` is classified the same way into `search_flat.rp_kind ∈ {valid,
  malformed, null}` — `valid` meaning the 4 expected camelCase fields parse. This matters
  because cuts #2, #3, #6, #7, #9 read fields out of `request_parameters`; their
  denominators are the `rp_kind = 'valid'` subset, and the malformed/null counts are
  reported so a reader knows what was excluded. `rp_kind` also always sums to 664,126.
- **Timezone:** UTC at source and in the report (the Phase 1/audit confirmed the dump
  header sets `SET TIME_ZONE='+00:00'`); no conversion.
- **Datetime parsing:** `pickupDateTime` / `returnDateTime` are ISO 8601 strings;
  non-parseable values are counted, not assumed.
- **Abort conditions:** load failure or reconciliation mismatch aborts the run — any
  analysis over a partial load would be invalid.

## 7. Analysis cuts

**Issue-defined (5):**
1. Volume + temporal range (`MIN`/`MAX(created_at)`), no-prune confirmation, rows/day.
2. Location distribution: top pickup, top return, NULL/empty rate.
3. Date distribution: searches per month/day; pickup-date distribution.
4. Quote error rate: array vs error share over all 664,126; breakdown by error code; plus
   the data-quality (malformed/null) counts from §6. Denominator: all rows.
5. Top categories. Two distinct figures, both reported so neither is ambiguous:
   (a) **search frequency** — for each category, how many `array`-kind searches returned
   it; (b) **availability rate** — that count over the count of `array`-kind searches
   (the only searches that could have returned a category). Denominator stated inline:
   `pd_kind = 'array'`.

**Extra cuts (6), cheap once loaded:**
6. Lead time: `pickup_dt − created_at`, bucketed. Denominator: `rp_kind = 'valid'`.
7. Rental duration: `return_dt − pickup_dt`, bucketed. Denominator: `rp_kind = 'valid'`.
8. Hour-of-day / day-of-week of searches (`created_at`). Denominator: all rows.
9. One-way vs round-trip: `pickup_location <> return_location` rate. Denominator:
   `rp_kind = 'valid'`.
10. `response_status` distribution. Denominator: all rows.
11. Average / median price per category (`total_amount` from `cat_quotes`). Denominator:
    the category rows in `cat_quotes` (i.e. quotes within `array`-kind searches).

## 8. Observable scenarios (SDD bridge)

- **SCEN-1** — Given the 27 chunks loaded, when `COUNT(*)` runs, then it equals 664,126
  (reconciles to the manifest total); otherwise the pipeline aborts.
- **SCEN-2** — Given the `pd_kind` classification, when the kinds are summed
  (array + error + malformed + null), then the total equals 664,126 (no row dropped
  silently).
- **SCEN-3** — Given the committed report and SQL, when grepped for PII (IP-value
  patterns, `response_raw`, email patterns), then zero matches.
- **SCEN-4** — Given the analysis queries, when re-run over the same loaded DB, then the
  aggregates are identical (deterministic).
- **SCEN-5** — Given teardown completes, then the datadir is deleted and no `mariadbd`
  listens on the custom socket.
- **SCEN-6** — Given each of the 11 cuts, when its query runs, then it produces a
  populated result whose total matches its declared denominator (§7): cuts #1, #4, #8, #10
  sum to 664,126 (all rows); cuts #6, #7, #9 sum to the `rp_kind = 'valid'` count; cuts #5,
  #11 sum to the `pd_kind = 'array'` count (or its exploded `cat_quotes` rows). A reviewer
  can mechanically check each total against the count it claims.

## 9. File layout

| Artifact | Path | Git |
|---|---|---|
| Spec | `docs/specs/2026-06-09-issue-45-phase3-analysis-log-veh-design.md` | tracked |
| Pipeline scripts + `analysis-queries.sql` | `scripts/analysis/log-veh/` | tracked, PII-free |
| Report | `docs/data-ops/2026-06-09-issue-45-phase3-analysis-log-veh/analysis-report.md` | tracked, PII-free |
| Throwaway datadir | `/tmp/log-veh-analysis-db/` | outside git |

## 10. Risks

- **PII leak into a committed artifact.** Mitigated by SCEN-3 (grep gate before commit),
  the datadir living in `/tmp`, and queries that never select PII values.
- **Partial / corrupt load read as complete.** Mitigated by SCEN-1 reconciliation gate.
- **Malformed JSON silently skewing rates.** Mitigated by §6 classification + SCEN-2.
- **Disk pressure during load.** ~30–40 GiB worst case vs ~930 GiB free — low risk;
  monitored during load.
