---
name: dataset-reports
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-09T00:00:00Z
spec: docs/specs/2026-06-09-issue-45-phase35-dataset-reports-design.md
issue: 45
phase: 3.5
---

# Scenarios — log_veh persistent dataset + formal reports (Phase 3.5)

Holdout contract for issue #45 Phase 3.5. Write-once after the first commit.

Target: an export step + report layer extending the Phase 3 pipeline (`scripts/analysis/log-veh/`).
After Phase 3's `materialize.sql` builds the PII-free `search_flat` (664,126 rows) and `cat_quotes`
(2,974,126 rows) in the throwaway MariaDB, `export-dataset.sh` writes them to a **gitignored**
Parquet snapshot via DuckDB; `reports/*.sql` (4 reports) run over the Parquet via DuckDB; and
`generate-reports.sh` emits a **committed PII-free** markdown report bundle. Consumer is
offline/ad-hoc — no dashboard wiring, no write to `public.search_logs`, read-only on the archive.

Validation surface: real execution. The export and reports are validated by running DuckDB against
the real materialized tables / the real Parquet, with row counts and aggregates anchored to the
merged Phase 3 report.

Key invariants:
- **Faithful snapshot.** The Parquet must reproduce the Phase 3 numbers exactly — a snapshot that
  drifts is wrong.
- **PII-free by allowlist.** Each Parquet's column set equals exactly its expected allowlist
  (§6 of the spec); any unexpected column — `source_ip`/`response_raw` or otherwise — fails the
  export. The committed bundle carries zero IPv4/IPv6/email.
- **Every share/rate report reconciles to its denominator;** pricing is a quantile report (medians
  don't sum) and is validated by input row count instead.
- **Reports decouple from MariaDB + the 6.8 GiB archive** once the Parquet exists.
- **Committed bundle is the durable persistence;** the Parquet is gitignored + regenerable.

Data fact used by denominators: `rp_kind='valid'` = 664,126 (100% — `request_parameters` is
`NOT NULL CHECK(json_valid)` with all 4 fields, so the valid subset equals all rows).

---

## SCEN-001: export produces faithful Parquet with exact row counts

**Given**: the throwaway MariaDB with `search_flat` (664,126 rows) and `cat_quotes` (2,974,126 rows)
materialized.
**When**: `export-dataset.sh` runs.
**Then**: `dataset/search_flat.parquet` and `dataset/cat_quotes.parquet` exist, and a DuckDB
`SELECT COUNT(*)` over each returns exactly 664,126 and 2,974,126.
**Evidence**: `duckdb -c "SELECT COUNT(*) FROM 'dataset/search_flat.parquet'"` → `664126`; same for
`cat_quotes.parquet` → `2974126`; both files present on disk.

## SCEN-002: snapshot is faithful to the merged Phase 3 report

**Given**: the exported Parquet.
**When**: a known anchor aggregate is queried with DuckDB
(`SELECT COUNT(*) FROM 'search_flat.parquet' WHERE pd_kind='array'`, and top category by frequency
over `cat_quotes.parquet`).
**Then**: the array count is 479,402 and the top category is `G4` with 434,746 — matching the merged
Phase 3 report exactly.
**Evidence**: DuckDB query outputs `479402` and `G4 | 434746`; both equal the committed Phase 3
`analysis-report.md` figures.

## SCEN-003: Parquet schema equals its allowlist (PII-free)

**Given**: the two Parquet files.
**When**: their column sets are inspected (`DESCRIBE SELECT * FROM '<f>.parquet'`).
**Then**: each equals exactly its allowlisted column set from the spec — `source_ip` and
`response_raw` are absent, and so is any other unexpected column.
**Evidence**: the column list of `search_flat.parquet` equals
{id, pickup_location, return_location, pickup_dt, return_dt, created_at, response_status, pd_kind,
rp_kind, error_code, n_categories}; `cat_quotes.parquet` equals
{search_id, category_code, category_description, total_amount, estimated_total_amount,
discount_amount, tax_fee_amount, iva_fee_amount, coverage_unit_charge, extra_hours_total,
rate_qualifier}; the export aborts if either differs.

## SCEN-004: each report reconciles to its declared denominator

**Given**: the Parquet snapshot.
**When**: `generate-reports.sh` runs the 4 reports via DuckDB.
**Then**: each produces a populated section reconciling to its denominator — **01 demand** sums to
664,126 (overall and per-branch, since `rp_kind='valid'`=664,126); **03 quote failure** sums to the
error subset 184,724 (its error-code breakdown sums to it); **04 availability** denominator is
`pd_kind='array'`=479,402 and **04 behavior** buckets each sum to `rp_kind='valid'`=664,126. **02
pricing** is carved out (quantiles don't sum): its per-category `n_quotes` sum to 2,974,126.
**Evidence**: each section's totals in the generated bundle equal the stated number; a reviewer can
mechanically check; no section is empty.

## SCEN-005: committed report bundle + report SQL are PII-free

**Given**: the generated report bundle and `reports/*.sql` staged for commit.
**When**: `check-pii.sh` scans them.
**Then**: zero IPv4/IPv6/email matches; no `response_raw`; `source_ip` appears nowhere (the reports
read only the PII-free Parquet, which has no such column).
**Evidence**: `check-pii.sh <bundle> reports/*.sql` → exit 0, `OK — no PII violations`.

## SCEN-006: Parquet gitignored, everything else tracked

**Given**: the repo after export + report generation.
**When**: `git status` / `git check-ignore` are inspected.
**Then**: `dataset/*.parquet` is gitignored (untracked AND ignored); the scripts, the 4 report SQL,
and the report bundle markdown are tracked.
**Evidence**: `git check-ignore dataset/search_flat.parquet` → matches; `git status --porcelain`
shows the `.parquet` neither staged nor listed as untracked-unignored; the bundle + scripts appear
as tracked additions.

## SCEN-007: deterministic regeneration

**Given**: a generated report bundle and the same Parquet.
**When**: the reports are regenerated.
**Then**: the new bundle is byte-identical to the previous one (report SQL uses explicit `ORDER BY`
with stable tie-breaks; no clock/random in the queries).
**Evidence**: `diff` of two consecutive `generate-reports.sh` outputs (excluding any run-timestamp
header line) → empty.
