# Implementation Plan — log_veh anticipation curve (Report 05, issue #45)

**Date:** 2026-06-10
**Spec:** `docs/specs/2026-06-10-issue-45-anticipation-curve-design.md` (approved, review-passed ×3)
**Holdout:** `docs/specs/2026-06-10-issue-45-anticipation-curve/scenarios/anticipation-curve.scenarios.md` (SCEN-001..008)
**Branch:** `task/issue-45-anticipation` (worktree, from `main` 1e836bd). PR uses `Refs #45`.

## Chunk 1: File structure + implementation steps

### Blast radius

**New files:**
- `scripts/analysis/log-veh/reports/05-anticipation.sql` — cuts 05a–05f (the analytical core).
- `docs/specs/2026-06-10-issue-45-anticipation-curve/scenarios/anticipation-curve.scenarios.md` — holdout (already committed).

**Modified files (additive; reports 01–04 SQL and `charts.mjs` / `render-*.sh` untouched):**
- `scripts/analysis/log-veh/generate-reports.sh` — append a 5th entry to `REPORT_FILES` + `REPORT_TITLES`.
- `scripts/analysis/log-veh/pdf/parse-bundle.mjs` — `MANIFEST += ["05","05a"]…["05","05f"]`.
- `scripts/analysis/log-veh/pdf/compose-html.mjs` — `REPORT_ORDER += "05"`; `REPORT_CUTS["05"]=["05a".."05f"]`;
  `TEXT_COLUMNS += lead_bucket, pickup_week, low_confidence`; new `chartsFor` "05" branch (line 05a + hbar 05d).
- `scripts/analysis/log-veh/pdf/compose-markdown.mjs` — same `REPORT_ORDER`/`REPORT_CUTS`/`TEXT_COLUMNS` additions.
- `scripts/analysis/log-veh/pdf/narrative.es.md` — `<!-- NARRATIVE: 05 -->` block, heading "Anticipación de precios".
- `tests/unit/analysis/log-veh-pdf/{parse-bundle,compose-html,compose-markdown}.test.ts` — extend for report 05.

**Regenerated (gitignored / committed-bundle):**
- Parquet `dataset/{search_flat,cat_quotes}.parquet` (gitignored, regenerable).
- The committed bundle `docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md`
  gains a `=== REPORT 05` section (committed text, PII-free).
- `report.html` / `report.md` / `*.pdf` (gitignored derived artifacts).

**Consumers:** `parse-bundle` MANIFEST (must gain 05a–05f), the two composers (REPORT_ORDER/REPORT_CUTS/
TEXT_COLUMNS/chartsFor), `generate-reports.sh` arrays. No other consumer reads the bundle.

### File responsibilities

| File | Responsibility |
|---|---|
| `05-anticipation.sql` | Compute cuts 05a–05f over the Parquet: index normalization, per-bucket-renormalized fixed-weight curve, base-100 index, pinned metrics, per-gama grid + top-6 summary, target-date escalation, 5-count reconciliation |
| `generate-reports.sh` | Run 05 alongside 01–04, append its block to the bundle |
| `parse-bundle.mjs` | Guard 05a–05f present (MANIFEST) |
| `compose-html.mjs` / `compose-markdown.mjs` | Order/align/chart Report 05 in the presentation |
| `narrative.es.md` | Spanish executive prose for Report 05 (humanized, cites real 05b figures) |

### Prerequisite — regenerate the Parquet dataset (mechanical, heavy)

The Parquet is gitignored and not materialized. Before Step 1 can be tested, run the self-contained pipeline:
`provision-db.sh` (throwaway socket-only MariaDB) → `load-archive.sh` (the 6.8 GiB chunked archive under
`.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended/`) → `materialize.sql` →
`export-dataset.sh` → Parquet in `scripts/analysis/log-veh/dataset/`. **Load check:** `search_flat` = 664,126,
`cat_quotes` = 2,974,126 (abort otherwise). This is a prerequisite, not an SDD step (no behavior of its own —
it reproduces the merged Phase 3 dataset). `teardown.sh` removes the throwaway DB.

### Implementation steps

SDD throughout: each step defines its scenario(s), writes code, converges. Sub-agents opus only; review +
validation agents after implementation. No test-only steps.

---

**Step 1 — `05-anticipation.sql`: the analytical core (cuts 05a–05f)**
Size: L → split into 1a/1b · Dependencies: Prerequisite (Parquet)
- **1a — index + curve + metrics (05a, 05b, 05c).** Scenario: *over the real Parquet, 05c exposes per-(category
  ×bucket) `median_idx`+`w_cat` for ALL categories; 05a's `weighted_median_idx` equals the per-bucket
  renormalized fixed-weight sum recomputed from 05c; `index_100` is integer with min=100 over n≥1000 buckets;
  05b's sweet_spot/urgency_3d/velocity_7→2 recompute from 05a's named buckets and sweet_spot is never
  low-confidence.* (SCEN-001, 002, 003, 004, 006) Build with a CTE chain: `priced` (filtered quotes + idx via
  `median(total_amount) OVER (PARTITION BY category_code)`), `bucketed` (lead_days→label), `cat_bucket`
  (median_idx, n, per-cat weight) → 05c; `curve` (renormalized weighted sum per bucket) → 05a; metrics → 05b.
  Median via `quantile_cont(...,0.5)`. Markers `=== REPORT 05 ===` / `--- 05a: … ---`. 05a rows ordered
  **ascending** by the sortable `lead_bucket` (`00_0d … 09_90plus`) — natural table order; the line chart
  reverses to far→near at render (Step 4). `low_confidence` is emitted as an explicit text token
  `CASE WHEN n_quotes<1000 THEN 'true' ELSE 'false' END` so the SQL output agrees with the composers' TEXT_COLUMNS
  classification (DuckDB would otherwise print a bare boolean).
  - Acceptance: `duckdb -c "SET VARIABLE dataset_dir='…'" -f 05-anticipation.sql` emits 05a/05b/05c; a recompute
    script reproduces 05a's `weighted_median_idx` from 05c row-for-row; `min(index_100 WHERE n_quotes>=1000)=100`
    and every `index_100` is integer; 05b's sweet_spot/urgency/velocity recompute from 05a's named buckets and
    sweet_spot has `n_quotes>=1000`; **(SCEN-003) a bucket with ≥1 category absent in 05c has a finite, positive,
    non-NULL `weighted_median_idx` equal to the present-only renormalized sum** (missing cells renormalize, never
    NULL-collapse/drag to 0); `low_confidence` renders as the literal `true`/`false`.
- **1b — per-gama summary, target dates, reconciliation (05d, 05e, 05f).** Scenario: *05d gives top-6 gama
  summary (sweet spot, min price, +%@3d); 05e ranks pickup-weeks by escalation_pct with every top row n≥1000;
  05f's five counts (4 drop reasons + analyzed) sum to exactly 2,974,126.* (SCEN-005, 008) Acceptance: 05f sums
  to 2974126; 05e top-30 all n_searches≥1000; 05d has ≤6 gamas.

**Step 2 — `generate-reports.sh` + regenerate the committed bundle**
Size: S · Dependencies: Step 1
- Scenario: *running `generate-reports.sh` appends a `=== REPORT 05` section (05a–05f) to the bundle, PII-free.*
  (feeds SCEN-007)
- Append `reports/05-anticipation.sql` to `REPORT_FILES` and "Report 05: …" to `REPORT_TITLES`; regenerate the
  bundle over the Parquet.
- **Regeneration-fidelity gate (Critical — the bundle is a shared test fixture).** The committed bundle is the
  SAME file the merged `parse-bundle`/`compose-html`/`compose-markdown` tests read, with hardcoded anchors
  (`01a AABOT=63258`, `01b 2025-12=48344`, period `mayo 2024 – mayo 2026`, `04c z_unparseable_or_null pct=0.0`).
  The load check (gross counts 664,126 / 2,974,126) would NOT catch per-branch/per-month drift. So before
  declaring done: `git diff` the bundle and assert **reports 01–04 are byte-identical** to the committed version
  (only the new `=== REPORT 05` block — and possibly the RUN-DATE header — may differ), AND run the existing
  `parse-bundle`/`compose-html`/`compose-markdown` tests **green against the regenerated bundle**. If 01–04
  drift, ABORT — the Parquet regeneration is not reproducing Phase 3 and the anchored-row-count premise is
  violated (do not publish a drifted bundle).
- Acceptance: the committed bundle contains `=== REPORT 05` with all six cut markers; `check-pii.sh` on the
  bundle exits 0; reports 01–04 byte-identical (git diff scoped to the new block); the three existing pdf tests
  pass against the regenerated bundle.

**Step 3 — `parse-bundle.mjs` MANIFEST + missing-cut guard**
Size: S · Dependencies: Step 2
- Scenario: *the parser parses 05a–05f from the regenerated bundle; its MANIFEST now requires the six 05 cuts —
  a bundle missing any 05 cut throws naming it.* (SCEN-007 parser half)
- Add the six `["05","05x"]` pairs to MANIFEST; extend the existing missing-cut test to drop a 05 cut and assert
  the throw. Acceptance: `pnpm test parse-bundle.test.ts` green against the regenerated bundle.

**Step 4 — composers: order, align, chart Report 05**
Size: M · Dependencies: Steps 2, 3
- Scenario: *`composeHtml`/`composeMarkdown` render a Report 05 section with the curve `line` (y=`index_100`,
  integer labels ≥100) and the per-gama `hbar` (05d, value=`pct_increase_at_3d`); `lead_bucket`/`pickup_week`/
  `low_confidence` render as text; determinism preserved.* (SCEN-007 presentation half)
- `compose-html.mjs`: `REPORT_ORDER += "05"`; `REPORT_CUTS["05"]`; `TEXT_COLUMNS += lead_bucket, pickup_week,
  low_confidence`; new `chartsFor` "05" branch — `line` over 05a's rows **reversed** (05a is stored ascending
  `00_0d…09_90plus`; reverse → far→near so price rises toward pickup on the right), `x=lead_bucket`,
  `y=numAt(r,'index_100')` (integer, renders faithfully) +
  `hbar(05d → label=category_description, value=numAt(r,'pct_increase_at_3d'))`.
  `compose-markdown.mjs`: same REPORT_ORDER/REPORT_CUTS/TEXT_COLUMNS additions (markdown has no charts).
- Tests: extend `compose-html`/`compose-markdown` tests — 05 heading present, `>1` 3-digit index label, hbar
  present, two-run byte-identical. Acceptance: `pnpm test tests/unit/analysis/log-veh-pdf/` green.

**Step 5 — `narrative.es.md` Report 05 block (humanized)**
Size: S · Dependencies: Step 1 (authoring needs the real 05b figures) + Step 4 (the "present after compose"
acceptance needs the composer's `REPORT_ORDER += "05"` to render the block)
- Scenario: *the composed HTML/Markdown contains the Spanish sentinel heading "Anticipación de precios" and an
  executive paragraph citing the real 05b figures (sweet spot, +%@3d, 7→2 velocity).* (SCEN-007 sentinel)
- Author the `<!-- NARRATIVE: 05 -->` block citing ONLY the computed 05b values; run through `/humanizer`; no raw
  PII tokens. Acceptance: `check-pii.sh narrative.es.md` exit 0; sentinel + figures present after compose.

**Step 6 — full pipeline render + verification**
Size: M · Dependencies: Steps 4, 5
- Scenario: *`render-pdf.sh`/`render-markdown.sh` over the regenerated bundle produce a `%PDF` / Markdown with the
  Report 05 section + curve chart; check-pii exits 0; HTML/MD byte-identical across two runs.* (SCEN-007 e2e)
- Run `/verification-before-completion`: fresh evidence for SCEN-001..008 (DuckDB cuts, reconciliation,
  reproduce-05a-from-05c, render, check-pii, determinism, full vitest suite, tsc, lint).
- Acceptance: all 8 holdout scenarios satisfied with fresh observable evidence.

### Testing strategy
- **SQL (DuckDB):** run 05-anticipation.sql over the Parquet; reconcile 05f to 2,974,126; reproduce 05a from
  05c; verify metrics derive from 05a; verify median (not avg) and confident-base.
- **Unit (vitest):** parse-bundle manifest + missing-cut; composer 05 rendering + determinism + integer index label.
- **E2E:** render PDF/MD; check-pii; determinism; bundle gains Report 05.
- Quality gate after implementation: 4-agent panel (code-reviewer, edge-case-detector, performance-engineer,
  code-simplifier) on the diff.

### Rollout
- No deploy surface (offline analysis). "Rollout" = merge the PR; regeneration is on-demand
  (`run-analysis.sh` → `generate-reports.sh` → `render-*.sh`).
- Rollback = revert the PR; nothing productive depends on it; no DB/Vercel state touched.
- Monitoring = N/A. Reconciliation (05f) + check-pii + determinism are the standing guarantees.
