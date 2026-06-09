# Implementation Plan — Issue #45 Phase 3.5: persistent dataset + formal reports

**Date:** 2026-06-09
**Spec (detailed design):** `docs/specs/2026-06-09-issue-45-phase35-dataset-reports-design.md` (commit a0fe050)
**Holdout (acceptance):** `docs/specs/2026-06-09-issue-45-phase35-dataset-reports/scenarios/dataset-reports.scenarios.md` (SCEN-001..007, commit 4dc56f6)
**Branch:** `task/issue-45-phase35-dataset` · **Worktree:** `.worktrees/issue-45-phase35-dataset`

Requirements/research/design are covered by the committed spec + holdout. This plan is the
file-structure map and the ordered, scenario-tied steps. It extends the Phase 3 pipeline already
merged in `scripts/analysis/log-veh/`.

---

## File Structure

| File | Responsibility | Git |
|---|---|---|
| `.gitignore` (edit) | Ignore `scripts/analysis/log-veh/dataset/` (the Parquet snapshot). | tracked |
| `scripts/analysis/log-veh/export-dataset.sh` | After Phase 3 `materialize.sql`, export `search_flat` + `cat_quotes` to Parquet via DuckDB. Primary: `ATTACH … TYPE mysql` over the socket + `COPY (SELECT …) TO '<f>.parquet' (FORMAT parquet)`. Fallback: `mariadb --batch` TSV → DuckDB `read_csv(delim='\t', nullstr='\N', columns={… DECIMAL(16,2) …})`. Post-export: allowlist schema assertion (§6) — abort on any unexpected column. | tracked |
| `scripts/analysis/log-veh/reports/01-demand-by-branch-month.sql` | DuckDB over Parquet: searches by pickup branch × month, seasonality, top pickup→return routes. | tracked |
| `scripts/analysis/log-veh/reports/02-pricing-by-category-season.sql` | Median/avg/p25/p75 `total_amount` per category × month (+ per branch) from `cat_quotes`. | tracked |
| `scripts/analysis/log-veh/reports/03-quote-failure-rate.sql` | Error share over all rows; error-code × branch × month. | tracked |
| `scripts/analysis/log-veh/reports/04-availability-and-behavior.sql` | Availability rate per category over time (`pd_kind='array'`); lead-time + duration + one-way/round-trip (`rp_kind='valid'`). | tracked |
| `scripts/analysis/log-veh/generate-reports.sh` | Run the 4 report SQLs over the Parquet via DuckDB; assemble a dated PII-free markdown bundle; abort if a Parquet is missing or a report errors. | tracked |
| `scripts/analysis/log-veh/query-examples.sql` | Copy-paste DuckDB snippets for ad-hoc Parquet querying. | tracked |
| `scripts/analysis/log-veh/check-pii.sh` (edit) | Extend default targets / accept the report bundle so the gate covers it (IPv4/IPv6/email = 0). | tracked |
| `scripts/analysis/log-veh/README.md` (append) | Export + generate-reports + ad-hoc query usage; the persistence/safe-copy note. | tracked |
| `docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md` | The generated PII-free report bundle. | tracked |
| `scripts/analysis/log-veh/dataset/{search_flat,cat_quotes}.parquet` | The snapshot. | **gitignored** |

Boundaries: `export-dataset.sh` (MariaDB→Parquet) and each `reports/*.sql` (DuckDB over Parquet)
share only the Parquet as interface; `generate-reports.sh` orchestrates + assembles markdown.

**Dev workflow note:** the Parquet is built once (Step 1) by running the Phase 3 pipeline
(provision→load→materialize→export). Steps 2–4 then iterate over the *existing* Parquet — instant,
no MariaDB, no 20-minute reload. That decoupling is the whole point of the snapshot.

---

## Prerequisites

- Phase 3 pipeline present (it is, merged at `f1287de`): `provision-db.sh`, `load-archive.sh`,
  `materialize.sql`.
- DuckDB CLI v1.5.2 (verified installed).
- Phase 2 archive reachable for the full build (`.worktrees/issue-45-phase2-extract/…`).

---

## Implementation Steps

### Phase 1 — Foundation

**Step 1 — Gitignore + `export-dataset.sh` (Parquet export)** · Size: M · Deps: none
Add `dataset/` to `.gitignore`; write `export-dataset.sh` to export the two materialized tables to
Parquet (DuckDB attach primary, TSV-bridge fallback with pinned `nullstr`/`DECIMAL`), then run the
allowlist schema assertion. Build the Parquet once over the full materialized tables.
*Scenario:* the analyst runs the pipeline through export → two Parquet files appear, faithful and
PII-free.
*Acceptance:* **SCEN-001** — DuckDB `COUNT(*)` over each Parquet = 664,126 / 2,974,126. **SCEN-002**
— `pd_kind='array'` = 479,402 and top category `G4` = 434,746 over the Parquet (matches merged
Phase 3 report). **SCEN-003** — each Parquet's column set equals its allowlist; an injected extra
column aborts the export. **SCEN-006** — `git check-ignore dataset/search_flat.parquet` matches; the
`.parquet` is neither tracked nor listed untracked-unignored.

### Phase 2 — Core (reports over the Parquet)

**Step 2 — Reports 01 demand + 02 pricing + `query-examples.sql`** · Size: M · Deps: Step 1
Write `reports/01-demand-by-branch-month.sql` and `reports/02-pricing-by-category-season.sql` (DuckDB
over Parquet, explicit deterministic `ORDER BY`), plus `query-examples.sql`.
*Scenario:* running each report over the Parquet returns populated, reconciling output.
*Acceptance:* **SCEN-004 (partial)** — demand totals sum to 664,126 (overall and per-branch);
pricing per-category `n_quotes` sum to 2,974,126 (quantile report, carved out of the sum-reconcile
check). Both non-empty.

**Step 3 — Reports 03 quote-failure + 04 availability+behavior** · Size: M · Deps: Step 1
Write `reports/03-quote-failure-rate.sql` and `reports/04-availability-and-behavior.sql`.
*Scenario:* both reports return populated, reconciling output over the Parquet.
*Acceptance:* **SCEN-004 (partial)** — failure error-code breakdown sums to 184,724; availability
denominator `pd_kind='array'` = 479,402; behavior buckets (lead-time/duration/trip-type) each sum to
`rp_kind='valid'` = 664,126.

### Phase 3 — Integration

**Step 4 — `generate-reports.sh` + bundle + `check-pii.sh` extension** · Size: M · Deps: Steps 2–3
Write `generate-reports.sh` (run the 4 reports → assemble the dated markdown bundle; abort on missing
Parquet / report error) and extend `check-pii.sh`. Concrete edit: `check-pii.sh`'s default target
list currently globs `*.sql` at `maxdepth 1` plus the Phase 3 report — add the new bundle path AND
the `reports/*.sql` subdir to the defaults, so a bare `check-pii.sh` (no args) covers the new
artifacts too (not only when paths are passed explicitly).
*Scenario:* one command turns the Parquet into a committed PII-free report bundle, reproducibly.
*Acceptance:* **SCEN-005** — `check-pii.sh` over the bundle + `reports/*.sql` → exit 0, 0
IPv4/IPv6/email. **SCEN-007** — two consecutive `generate-reports.sh` runs diff empty (excluding a
run-date header line). All four report sections present and populated in the bundle (**SCEN-004**
end-to-end).

### Phase 4 — Polish

**Step 5 — README + full e2e run + quality gate + verification + PR** · Size: M · Deps: Step 4
Append the README usage/persistence note; run the full pipeline end-to-end (provision→load→
materialize→export→generate-reports) over the real 664,126-row archive to produce the committed
bundle; run the 4-agent quality gate over the new scripts/SQL; `/verification-before-completion`.
*Scenario:* a reviewer reproduces the run from the README and trusts the bundle + gate.
*Acceptance:* SCEN-001..007 green on a fresh run with the real data; quality-gate findings addressed
or justified; bundle committed; PR opened with `Refs #45`.
*Time anchor:* the full e2e rebuild runs the Phase 3 pipeline (~13 min load + ~6 min materialize +
export), so budget ~25 min for the run alone; the step stays ≤M because Steps 1–4 already produced
and validated the scripts — Step 5 mostly re-runs e2e + reviews, it doesn't author new logic.

---

## Testing Strategy

- **Scenario-driven:** SCEN-001..007 are the acceptance contract; each functional step carries its
  scenario inline (no separate "add tests" steps).
- **Execution evidence:** real DuckDB runs over the real Parquet (built from the real 664k archive),
  anchored to the merged Phase 3 numbers (SCEN-002).
- **Determinism:** SCEN-007 diff guards nondeterministic report SQL.
- **PII gate:** `check-pii.sh` over the committed bundle (SCEN-005) + allowlist schema assertion
  (SCEN-003).
- **Quality gate:** Step 5 runs code-reviewer + edge-case + performance + security over the new
  scripts/SQL.

## Rollout Plan

- **Deliverable:** committed scripts + 4 report SQL + report bundle on `task/issue-45-phase35-dataset`;
  PR `Refs #45` (issue stays open only on the deferred ML/price-prediction roadmap).
- **No production surface:** nothing deploys; no write to `public.search_logs`; archive read-only.
- **Rollback:** additive (new scripts + bundle + one .gitignore line); reverting the branch removes
  it cleanly. The gitignored Parquet is local-only.

## Open Questions (deferred, non-blocking)

- Price-prediction modeling and the new project persisting quoted prices — explicitly out of scope
  (roadmap note in the spec §2).
