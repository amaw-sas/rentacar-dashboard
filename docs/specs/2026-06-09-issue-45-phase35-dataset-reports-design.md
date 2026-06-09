# Issue #45 Phase 3.5 — persistent analytical dataset + formal reports

**Date:** 2026-06-09
**Branch:** `task/issue-45-phase35-dataset`
**Status:** Design — pending spec review + user approval
**Builds on:** Phase 3 (PR #110, merge `f1287de`) — the `scripts/analysis/log-veh/` pipeline
that loads the extracted `log_veh` archive into a throwaway MariaDB and materializes
`search_flat` (664,126 rows) + `cat_quotes` (2,974,126 rows).
**Input archive:** `.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended/`
(27 gz chunks + manifest, gitignored, carries PII).

---

## 1. Context

Phase 3 produced a one-shot exploratory report by running SQL over a throwaway MariaDB that
takes ~20 minutes to build from the 6.8 GiB raw archive. This phase answers the issue's
remaining open question — where the **persistent** analytical dataset lives — and delivers the
**formal reports** that were the point of extracting this history.

Two facts shape the decision:

- **The analytics module already exists** (`app/(dashboard)/analytics/`, reading
  `public.search_logs`). But the legacy `log_veh` data is lossy against that schema (no
  `franchise`, `referral_code`, `selected_category_code`, `converted_to_reservation`), which is
  exactly why the issue forbids writing it to `public.search_logs`. The consumer chosen for
  this dataset is **offline / ad-hoc**, not the live dashboard.
- **`public.search_logs` stores no prices** (its columns carry search params + result counts +
  conversion, but no `total_amount`). `log_veh.cat_quotes` is therefore the *only* clean
  historical corpus of quoted prices (2 years, ~3M typed rows). That makes this dataset
  irreplaceable for any future price analysis, and worth persisting compactly so it outlives
  both the 6.8 GiB archive and the 20-minute MariaDB rebuild.

## 2. Goals / Non-goals

**Goals**
- Persist the PII-free materialized tables as a compact, instantly-queryable **Parquet
  snapshot** (`search_flat.parquet` + `cat_quotes.parquet`), queryable with DuckDB without
  MariaDB or the raw archive.
- Deliver a **set of 4 formal, versioned reports** over that snapshot, emitted as a committed
  PII-free markdown bundle: demand by branch × month, pricing by category × season, quote
  failure rate, and availability + booking behavior.
- Keep everything decoupled from the productive ETL and the live dashboard; no write to
  `public.search_logs`; read-only on the archive.

**Non-goals (YAGNI)**
- Wiring the dataset into the live dashboard analytics pages (consumer is offline/ad-hoc).
- Any price-prediction model or ML feature engineering — explicitly deferred. (Roadmap note:
  productive prediction would also require the new project to start persisting quoted prices,
  which it currently does not.)
- Committing the Parquet to git (the user's standing preference is that data artifacts are not
  committed; the snapshot stays gitignored and regenerable, while the *reports* are committed).

## 3. Approach

Extend the Phase 3 pipeline with an export step and a report layer. DuckDB (already installed,
v1.5.2) is both the exporter and the report engine, so the snapshot and the reports use one
tool and the reports never need MariaDB once the Parquet exists.

Rejected alternatives:
- **Persist into Supabase/Postgres** — only justified if the live dashboard consumed it; the
  chosen consumer is offline, so a Postgres table adds operational-DB weight for no runtime
  benefit and risks blurring the `search_logs` boundary.
- **DuckDB database file instead of Parquet** — Parquet is tool-agnostic (DuckDB / pandas /
  polars) and future-proof; DuckDB reads it directly with zero import.
- **Re-query MariaDB for each report** — couples reports to the 20-minute rebuild; the Parquet
  snapshot makes reports instant and archive-independent.

## 4. Components

All under `scripts/analysis/log-veh/` unless noted.

| File | Responsibility | Git |
|---|---|---|
| `export-dataset.sh` | After `materialize.sql`, export `search_flat` + `cat_quotes` (PII-free columns only) to Parquet via DuckDB. Primary: DuckDB `ATTACH` the MariaDB over its Unix socket (`TYPE mysql`) and `COPY (SELECT …) TO '<f>.parquet' (FORMAT parquet)`. Fallback: `mariadb --batch -e 'SELECT …'` to TSV on stdout → DuckDB `read_csv` → Parquet. The fallback MUST pin `read_csv` explicitly — `delim='\t'`, `nullstr='\N'` (mariadb's NULL marker), and an explicit `columns={...}` map giving each amount column `DECIMAL(16,2)` (NOT inferred, which would coerce to DOUBLE and break SCEN-002 exactness) — so the fallback Parquet is type-identical to the attach path. Post-export, run the allowlist schema assertion (see §6). Output to the gitignored `dataset/` dir. | tracked |
| `reports/01-demand-by-branch-month.sql` | DuckDB over Parquet: searches by pickup branch × month, seasonality, top pickup→return routes. Denominator: all rows / `rp_kind='valid'` for branch cuts. | tracked |
| `reports/02-pricing-by-category-season.sql` | Median + avg + p25/p75 `total_amount` per category × month (and per branch), from `cat_quotes`. The price corpus. | tracked |
| `reports/03-quote-failure-rate.sql` | Error share over all rows; error-code × branch × month breakdown; which branches/months fail most. | tracked |
| `reports/04-availability-and-behavior.sql` | Availability rate per category over time (denominator `pd_kind='array'`); booking behavior — lead-time + rental-duration buckets + one-way vs round-trip (denominator `rp_kind='valid'`). | tracked |
| `generate-reports.sh` | Run the 4 report SQLs over the Parquet via DuckDB, assemble a dated PII-free markdown bundle. Fails if a Parquet is missing or a report errors. | tracked |
| `query-examples.sql` | Copy-paste DuckDB snippets for ad-hoc querying of the Parquet. | tracked |
| `README.md` (append) | How to export, generate reports, and query ad-hoc; the persistence note. | tracked |
| `docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md` | The generated report bundle (PII-free aggregates). | tracked |
| `dataset/search_flat.parquet`, `dataset/cat_quotes.parquet` | The snapshot. | **gitignored** |

Boundaries: `export-dataset.sh` owns MariaDB→Parquet and knows nothing about report shapes;
each `reports/*.sql` is a standalone DuckDB query over Parquet that knows nothing about
MariaDB; `generate-reports.sh` only orchestrates DuckDB + assembles markdown. The Parquet is
the single interface between the two halves.

## 5. Data flow

```
raw archive (6.8 GiB, gitignored, PII)
  → [Phase 3: provision → load → materialize]  → search_flat + cat_quotes  (throwaway MariaDB, /tmp)
  → [export-dataset.sh]                          → *.parquet                 (gitignored, PII-free)
  → [reports/*.sql via DuckDB]                   → report bundle markdown    (committed, PII-free)
```

Once the Parquet exists, the report layer is fully decoupled: no MariaDB, no 6.8 GiB archive,
no 20-minute rebuild.

## 6. PII boundary

- The export selects only `search_flat` (which has no `source_ip` column — it was never
  materialized) and `cat_quotes` (no PII columns). `response_raw` is never touched anywhere.
- Post-export schema assertion uses an **allowlist**, not a denylist: each Parquet's column set
  must equal exactly the expected list (`search_flat`: id, pickup_location, return_location,
  pickup_dt, return_dt, created_at, response_status, pd_kind, rp_kind, error_code,
  n_categories; `cat_quotes`: search_id, category_code, category_description, total_amount,
  estimated_total_amount, discount_amount, tax_fee_amount, iva_fee_amount, coverage_unit_charge,
  extra_hours_total, rate_qualifier). Any unexpected column — including but not limited to
  `source_ip`/`response_raw` — fails the export. This catches accidental future column additions
  that carry signal, not just the two known PII names.
- The report bundle is aggregates only → PII-free. `check-pii.sh` is extended to scan the
  committed report bundle (IPv4/IPv6/email = 0) in addition to the Phase 3 targets.
- Committed artifacts (scripts, report SQL, report bundle) are PII-free. The Parquet
  (gitignored) is PII-free too, but stays out of git per the data-artifact preference.

**Data fact (used by the report denominators):** `rp_kind='valid'` = **664,126** — i.e. 100% of
rows. `request_parameters` is `NOT NULL CHECK (json_valid(...))` in the legacy schema and all
four camelCase fields are always present, so the "valid" subset equals all rows. This is why
the demand and behavior reports' `rp_kind='valid'` denominators coincide with the all-rows
664,126 (confirmed in the merged Phase 3 run).

## 7. Persistence model

- **Committed and durable:** the scripts, the 4 report queries, and the **report bundle
  markdown**. The findings survive in git even if the Parquet and the 6.8 GiB archive are
  deleted.
- **Gitignored and regenerable:** the two `.parquet` files. Regenerating requires the Phase 2
  archive (preserved in its worktree) and a pipeline run. The README states this explicitly and
  recommends keeping one manual copy of the ~30–55 MB Parquet somewhere safe, because the only
  alternative regeneration path — re-extracting from the legacy DB — is a full Phase 2 redo.

## 8. Error handling / edge cases

- **Missing Parquet:** `generate-reports.sh` aborts with a clear message if either Parquet is
  absent (no silent empty reports).
- **DuckDB MySQL attach failure** (socket quirk): `export-dataset.sh` falls back to the
  TSV-bridge path. The two paths produce a type-identical Parquet only because the fallback pins
  `nullstr='\N'` and explicit `DECIMAL(16,2)` column types (§4) — without that, TSV inference
  would coerce amounts to DOUBLE and SCEN-002's faithfulness check would catch the drift. If both
  paths fail, it aborts (no partial export).
- **Empty / zero-denominator report cells:** report SQL guards percentage divisions (NULLIF) so
  a zero denominator yields NULL, not an error.
- **Determinism:** report SQL uses explicit `ORDER BY` with stable tie-breaks; re-runs are
  byte-identical.
- **Faithfulness:** the snapshot must reproduce the Phase 3 numbers — a known aggregate over the
  Parquet (e.g. `pd_kind='array'` = 479,402) must match the merged Phase 3 report, or the export
  is wrong.

## 9. Observable scenarios (SDD bridge)

- **SCEN-001** — Given the materialized tables, when `export-dataset.sh` runs, then
  `search_flat.parquet` and `cat_quotes.parquet` exist and their row counts equal 664,126 and
  2,974,126.
- **SCEN-002** — Given the exported Parquet, when a known aggregate is queried with DuckDB
  (`SELECT COUNT(*) FROM 'search_flat.parquet' WHERE pd_kind='array'`), then it returns 479,402
  and the top category by frequency is G4 with 434,746 — matching the merged Phase 3 report
  (faithful snapshot).
- **SCEN-003** — Given the two Parquet files, when their schemas are inspected, then each
  column set equals exactly its allowlist (§6) — `source_ip` and `response_raw` are absent, and
  so is any other unexpected column (PII-free by construction, allowlist-enforced).
- **SCEN-004** — Given the Parquet, when `generate-reports.sh` runs, then each of the 4 reports
  produces a populated section reconciling to its declared denominator:
  - **01 demand** → all rows = **664,126** (and its branch cuts also sum to 664,126, since
    `rp_kind='valid'` = 664,126 — see the data-fact note in §6).
  - **03 quote failure** → the error subset = **184,724** (the error-code breakdown sums to it).
  - **04 availability** → `pd_kind='array'` = **479,402**; **04 behavior** → `rp_kind='valid'`
    = **664,126** (lead-time / duration / trip-type buckets each sum to it).
  - **02 pricing** is a quantile report (medians/percentiles do NOT sum), so it is carved out of
    the "totals reconcile" check: it is validated instead by its input row count — the sum of
    `n_quotes` across categories equals **2,974,126** (`cat_quotes` rows) — and by SCEN-002's
    faithfulness anchor.
- **SCEN-005** — Given the committed report bundle and the report SQL, when scanned by
  `check-pii.sh`, then zero IPv4/IPv6/email matches and no PII column references.
- **SCEN-006** — Given the repo, when `git status` is checked, then `dataset/*.parquet` is
  gitignored and only the scripts, report SQL, and report bundle are tracked.
- **SCEN-007** — Given a generated bundle, when reports are regenerated from the same Parquet,
  then the output is byte-identical (deterministic).

## 10. Risks

- **Snapshot drifts from source.** Mitigated by SCEN-002 (a Phase-3-anchored aggregate must
  match) — the export is rejected if the numbers move.
- **PII column leaks into Parquet.** Mitigated by export selecting only PII-free tables + the
  SCEN-003 schema assertion + SCEN-005 bundle grep.
- **Dataset lost with the worktree.** Accepted trade-off of the gitignored-regenerable choice;
  mitigated by the committed report bundle (findings persist) + the README's safe-copy
  recommendation.
- **DuckDB mysql-attach over socket is finicky.** Mitigated by the TSV-bridge fallback, which is
  driver-free and bulletproof.
