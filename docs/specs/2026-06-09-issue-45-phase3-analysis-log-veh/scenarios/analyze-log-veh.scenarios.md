---
name: analyze-log-veh
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-09T00:00:00Z
spec: docs/specs/2026-06-09-issue-45-phase3-analysis-log-veh-design.md
issue: 45
phase: 3
---

# Scenarios — Exploratory analysis of legacy `log_veh` (Phase 3)

Holdout contract for issue #45 Phase 3 (analysis only). Write-once after first commit.

Target: a deterministic, reproducible, PII-free analysis pipeline over the already-extracted
`log_veh_available_rates_queries` archive (664,126 rows, 27 gzipped `mysqldump` chunks +
`manifest.json` produced by Phase 2, gitignored, carrying PII). The pipeline loads the
archive into a throwaway MariaDB sandbox, materializes `search_flat` (one row per search) +
`cat_quotes` (exploded category quotes), runs versioned PII-free SQL, and produces a markdown
report. Deliverable is the report + the SQL ONLY — no persistent dataset, no write to
`public.search_logs`, no write to the legacy source (the archive is read-only here).

Two validation surfaces:
- **Loaded-DB execution** (faithful load, reconciliation, classification totals, the 11
  cuts) — validated by SQL run against the throwaway MariaDB and transcribed into
  `docs/data-ops/2026-06-09-issue-45-phase3-analysis-log-veh/analysis-report.md`.
- **Committed-artifact hygiene** (PII boundary, determinism, teardown) — validated by
  grep/inspection of the committed report + SQL and of the host after teardown.

Key invariants:
- **Analysis only over the faithful full dataset.** The loaded `COUNT(*)` must equal the
  manifest total `664,126` exactly; any mismatch aborts — a partial load invalidates every
  rate and distribution.
- **Nothing dropped silently.** Every row is classified: `search_flat.pd_kind ∈ {array,
  error, malformed, null}` and `search_flat.rp_kind ∈ {valid, malformed, null}`. Each
  classification sums to `664,126`. Malformed/null counts are reported, not hidden.
- **Every cut declares its denominator.** All-rows cuts sum to `664,126`; `request_parameters`
  cuts sum to the `rp_kind='valid'` count; category cuts sum to the `pd_kind='array'` count.
- **PII never enters git.** The committed report + SQL never carry `response_raw` or
  `source_ip` values; `source_ip` appears only as an aggregate. Primary control is
  query construction (queries never reference those columns as values); a pinned grep is the
  defense-in-depth backstop.
- **Throwaway + deterministic.** The datadir lives in `/tmp`, is deleted on completion, and
  re-running the queries over the same loaded DB yields identical aggregates.

---

## SCEN-001: faithful full load reconciles to the manifest total

**Given**: the 27 gzipped chunks from the Phase 2 archive and a freshly provisioned throwaway
MariaDB sandbox (socket-only, no TCP).
**When**: every chunk is restored in PK order (chunk 1 carries `CREATE TABLE`), each with its
exit code checked under `set -o pipefail`, and the loaded table is counted.
**Then**: `SELECT COUNT(*)` equals `664,126` exactly (the manifest `total_rows`); on any
mismatch the pipeline aborts before any analysis runs.
**Evidence**: `COUNT(*)` → `664126`, matching `manifest.json:total_rows`; the abort path is
exercised (a deliberately short load reconciles to a smaller count and halts the run, not the
report).

---

## SCEN-002: no row dropped silently — classifications sum to the total

**Given**: the loaded table, where `processed_data` is sometimes a quotes array, sometimes an
error object, sometimes malformed/NULL, and `request_parameters` is sometimes valid, sometimes
malformed/NULL.
**When**: `search_flat` is materialized with `pd_kind` and `rp_kind`.
**Then**: `SELECT pd_kind, COUNT(*) GROUP BY pd_kind` sums to `664,126` across `{array, error,
malformed, null}`, and `SELECT rp_kind, COUNT(*) GROUP BY rp_kind` sums to `664,126` across
`{valid, malformed, null}`. No row is excluded from either classification.
**Evidence**: both `GROUP BY` totals → `664126`; the malformed/null buckets are present in the
report's data-quality section (count reported even when zero).

---

## SCEN-003: committed artifacts are PII-free

**Given**: the analysis report and `analysis-queries.sql` staged for commit.
**When**: they are grepped against the pinned PII pattern floor — IPv4
(`\b\d{1,3}(\.\d{1,3}){3}\b`), email (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`) — and
checked for the literal column names.
**Then**: zero IP-value and zero email matches; `response_raw` never appears; `source_ip`
appears only as an aggregate expression (e.g. `COUNT(DISTINCT source_ip)`), never selecting its
values into output.
**Evidence**: grep → `0` matches for IP/email patterns over the committed report + SQL; manual
read confirms `source_ip` only inside aggregate functions and `response_raw` absent.

---

## SCEN-004: deterministic re-run

**Given**: the loaded throwaway DB and the versioned `analysis-queries.sql`.
**When**: the query file is executed a second time over the same loaded data.
**Then**: every cut's aggregate output is byte-identical to the first run (no
`Date.now`/random/ordering nondeterminism in the queries).
**Evidence**: a diff of two consecutive query-run outputs → empty; ordered results use
deterministic `ORDER BY` (ties broken by a stable key).

---

## SCEN-005: teardown leaves no datadir and no live server

**Given**: the analysis is complete (report transcribed).
**When**: teardown runs — `mariadb-admin … shutdown` (no `kill`) then datadir removal
(`find … -delete`, no `rm -rf`).
**Then**: the `/tmp` datadir no longer exists and no `mariadbd` listens on the custom socket;
no PII remains on disk outside the gitignored Phase 2 archive.
**Evidence**: `test -d <datadir>` → absent; no `mysqld`/`mariadbd` process bound to the custom
socket; `ls` of the socket path → gone.

---

## SCEN-006: each cut populates and totals match its declared denominator

**Given**: the loaded DB with `search_flat` + `cat_quotes` materialized.
**When**: each of the 11 cuts runs (volume+range, location, date, error rate, top categories,
lead time, rental duration, hour/day, one-way vs round-trip, response_status, price per
category).
**Then**: each produces a non-empty result whose total equals the denominator it declares —
cuts #1/#4/#8/#10 sum to `664,126` (all rows); cuts #6/#7/#9 sum to the `rp_kind='valid'`
count; cuts #5/#11 sum to the `pd_kind='array'` count (or its exploded `cat_quotes` rows). A
reviewer can mechanically check each reported total against the count it claims.
**Evidence**: each cut's row totals reconcile to its stated denominator in the report; no cut
is empty; the all-rows cuts re-sum to `664126`.
