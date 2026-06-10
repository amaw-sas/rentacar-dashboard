# Design — log_veh anticipation-curve analysis (Report 05, issue #45)

**Date:** 2026-06-10
**Status:** approved (brainstorming)
**Scope:** add a price-vs-booking-anticipation analysis (directive points 1–3) as **Report 05** in the existing
log_veh report bundle, computed over the historical quote archive.

## 1. Problem

Management wants to tell customers *when to book*: the cheapest lead-time ("momento dulce"), the urgency near
pickup ("faltando 3 días sube ~X%"), and the rate of increase (7d vs 2d → "resérvalo ya"). The merged reports
01–04 cover demand, pricing, failure and availability, but none expresses **price as a function of booking
anticipation**. The data exists: `cat_quotes.total_amount` (price per category quote) joined to `search_flat`
(`created_at`, `pickup_dt`) yields, per quote, a (lead-time, price) pair.

## 2. Goals / Non-goals

**Goals**
- A credible **price-vs-anticipation curve** with an actionable "sweet spot", urgency-at-3-days, and 7d→2d
  velocity, for management.
- A per-gama breakdown (top categories) and a target-date view (which pickup dates escalate fastest).
- Delivered as **Report 05** in the existing bundle, reusing `generate-reports.sh` + the PDF/Markdown pipeline.
- Methodologically honest about the organic-traffic confound.

**Non-goals**
- No conversion/booking linkage (proven infeasible — the reservation `reference_token` is an incompatible
  encoding; see the prior spike). This is a quotes-only analysis.
- No causal claim. The dataset is organic search traffic, not a controlled panel; we control the gama-mix
  confound by normalization and disclose the residual route/target-date mix.
- No forward/live capability — the productive `search_logs` does not persist prices; this is a one-shot over the
  historical archive.

## 3. Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Granularity | Normalized **index** (price ÷ gama median) + top-gama breakdown | Removes the gama-mix confound; gives one national message with rigor |
| Lead-time buckets | Fine near pickup: `0,1,2,3,4-7,8-14,15-30,31-60,61-90,90+` days | Day resolution where booking decisions happen; grouped tail avoids noise |
| Headline metrics | Sweet spot = min-index bucket; urgency = index(≤3d)÷min−1; velocity = index(2d)÷index(4-7d)−1 | Anchored to the directive's own framing |
| Aggregation | **Median** index per bucket (+ p25/p75) | Robust to the 95M-COP price outliers |
| Output | **Report 05** in the existing bundle | Reuses the full reporting + presentation pipeline; reports 01–04 untouched |
| Conversion (points 6-9) | Out of scope | No usable join key (verified) |

## 4. Methodology

**Per-quote normalization (confound control).**
```
idx = total_amount / median(total_amount) OVER (PARTITION BY category_code)
```
The category median is taken over **all priced quotes of that category** in the archive. `idx` is dimensionless
and comparable across categories, so pooling categories into one national curve no longer mixes price scales.
Interpretation: `idx = 1.41` at a bucket means "41% above that category's typical price".

**Lead-time.**
```
lead_days = datediff('day', cast(created_at as date), cast(pickup_dt as date))
```
Bucketed into the 10 ordered buckets above (sortable labels `00_0d … 09_90plus`).

**Filters (all cuts).** `lead_days >= 0` (negative = created after pickup = dirty), `total_amount > 0`,
`category_code` not null. `cat_quotes` already contains only `pd_kind='array'` priced quotes.

**Aggregation.** Per bucket: `count(*)`, `median(idx)`, `quantile(idx,0.25/0.75)`. The headline curve rebases:
`idx_rebased = median_idx / min(median_idx over buckets)` → base `1.00` at the sweet spot.

**Low-confidence flagging.** Any bucket (or gama×bucket) with `n_quotes < 1000` is marked low-confidence in the
output so management doesn't over-read a thin tail.

## 5. Report cuts (DuckDB over Parquet, pattern of reports/01–04)

`reports/05-anticipation.sql` runs over `cat_quotes.parquet` JOIN `search_flat.parquet` on `sf.id = cq.search_id`.
Cuts (each a DuckDB `-markdown` result set with the `--- 05x: … ---` marker, like the merged reports):

- **05a — global anticipation curve.** Columns: `lead_bucket, n_quotes, median_idx, p25_idx, p75_idx,
  idx_rebased, low_confidence`. One row per bucket, ordered. The headline curve.
- **05b — actionable metrics (one row).** `sweet_spot_bucket, sweet_spot_idx, urgency_3d_pct (= idx_le3d/min −1),
  velocity_7to2_pct (= idx_2d/idx_4_7d −1), n_quotes_total`.
- **05c — per-gama (top 6 by n_quotes).** Per `(category_code, lead_bucket)`: `median_total_amount` (COP) and
  `median_idx`; plus a per-gama summary row set: `category_code, category_description, sweet_spot_bucket,
  min_median_price, pct_increase_at_3d`.
- **05d — target dates that escalate fastest (point 2).** Per ISO `pickup_week` (and/or month): `n_searches`
  (demand) and `escalation_pct = median_idx(lead≤3d) / median_idx(lead≥30d) − 1`, ranked desc, top 30. Surfaces
  holidays/puentes for inventory + Ads budgeting. Weeks with `n_searches < 1000` flagged.
- **05e — reconciliation.** `n_quotes` used (sum over 05a buckets) vs total priced `cat_quotes`; the dropped
  count by reason (negative lead-time, null price/category). Numbers must reconcile.

`generate-reports.sh` is extended to run `05-anticipation.sql` and append its block to the committed bundle,
exactly as it does for 01–04 (same `SET VARIABLE dataset_dir`, atomic publish, PII-free markdown).

## 6. Presentation (reuse the merged PDF/Markdown pipeline)

- `narrative.es.md`: a new `<!-- NARRATIVE: 05 -->` block, heading **"Anticipación de precios"** (Spanish, run
  through `/humanizer`), citing the real 05b figures (sweet spot, +% at 3d, 7→2 velocity) once computed.
- `compose-html.mjs` / `compose-markdown.mjs`: add `"05"` to `REPORT_ORDER` and `REPORT_CUTS`
  (`["05a","05b","05c","05d","05e"]`); add report-05 charts.
- **Charts (§6 of the parent spec):** Report 05 → `line(05a → x = lead_bucket far→near, y = idx_rebased)` (the
  curve) + `hbar(05c per-gama → value = pct_increase_at_3d)`.
- `render-pdf.sh` / `render-markdown.sh`: unchanged (they already render whatever the bundle/composers contain).

## 7. Data prerequisite (regeneration)

The Parquet dataset (`search_flat.parquet` 664,126; `cat_quotes.parquet` 2,974,126) is **gitignored and not
currently materialized**. It must be regenerated via the self-contained pipeline before the report can run:
`provision-db.sh` (throwaway socket-only MariaDB) → `load-archive.sh` (the 6.8 GiB chunked archive) →
`materialize.sql` → `export-dataset.sh` (Parquet) → `teardown.sh`. Deterministic and mechanical; the cost is
compute time. Row counts are anchored to the merged Phase 3 numbers (664,126 / 2,974,126) as a load check.

## 8. Error handling / validity

| Failure | Behavior |
|---|---|
| Parquet missing | `generate-reports.sh` aborts (dataset not materialized) — run the pipeline first |
| Row counts ≠ 664,126 / 2,974,126 | load is incomplete — abort before reporting |
| Bucket with n_quotes < 1000 | rendered with a `low_confidence` flag, not hidden |
| 05e does not reconcile | report is wrong — investigate, do not publish |
| Negative/null lead-time or price | excluded by filter, counted in 05e's dropped tally |

## 9. File structure

```
scripts/analysis/log-veh/
  reports/05-anticipation.sql      # NEW — cuts 05a–05e
  generate-reports.sh              # MODIFIED — include report 05 in the bundle
  pdf/narrative.es.md              # MODIFIED — + NARRATIVE 05 block (humanized)
  pdf/compose-html.mjs             # MODIFIED — REPORT_ORDER/REPORT_CUTS + report-05 charts
  pdf/compose-markdown.mjs         # MODIFIED — REPORT_ORDER/REPORT_CUTS + report-05 caption
docs/specs/2026-06-10-issue-45-anticipation-curve/scenarios/*.scenarios.md   # holdout
docs/data-ops/.../reports/log-veh-reports-<date>.md   # the committed bundle gains a Report 05 section
```
Reports 01–04 SQL and the PDF/MD render scripts are untouched. The Parquet stays gitignored.

## 10. Testing strategy

- **Report correctness (DuckDB execution):** run `05-anticipation.sql` over the regenerated Parquet; assert
  05e reconciles; assert the curve is monotone-ish (median_idx non-decreasing as lead-time shrinks past the
  sweet spot is expected but NOT forced — if it isn't, that's a real finding, not a bug); assert 05b's metrics
  equal the values derivable from 05a.
- **Presentation (unit, vitest):** `compose-html`/`compose-markdown` include the Report 05 heading + its chart;
  determinism preserved; `parse-bundle` parses 05a–05e (the existing parser is generic — add 05 to its manifest
  if it has one).
- **End-to-end:** `render-pdf.sh` / `render-markdown.sh` produce `%PDF`/Markdown with the new section; check-pii
  passes; determinism holds.

## 11. Observable scenarios (holdout for SDD)

1. **Curve produced** — `05-anticipation.sql` over the Parquet yields cut 05a with the 10 ordered buckets, each
   with `n_quotes` and `median_idx`, and a `min`-rebased `idx_rebased` whose minimum is exactly `1.00`.
2. **Index controls gama mix** — `idx` is `total_amount ÷ per-category median`; the per-category median of `idx`
   equals ~1.0 by construction (sanity), and pooling categories does not let an expensive gama dominate the
   curve.
3. **Metrics derive from the curve** — 05b's `sweet_spot_bucket` is exactly the 05a bucket with min `median_idx`;
   `urgency_3d_pct` and `velocity_7to2_pct` equal the values recomputed from 05a.
4. **Reconciliation** — 05e: `Σ n_quotes` over 05a buckets + dropped(negative/null) = total priced `cat_quotes`
   (2,974,126); no quote is silently lost.
5. **Robustness** — aggregation uses median (a single 95M-COP outlier does not move the bucket's reported value);
   buckets with `n_quotes < 1000` carry the `low_confidence` flag.
6. **Report 05 in the bundle + presentation** — the committed markdown bundle gains a Report 05 section; the
   composed HTML/Markdown contains the **"Anticipación de precios"** heading, the curve `line` chart, and the
   per-gama `hbar`; PDF renders (`%PDF`), check-pii passes, determinism holds.
7. **Target-date escalation (point 2)** — 05d ranks pickup-weeks by `escalation_pct` desc and reports each
   week's `n_searches`; the top rows are high-demand weeks (e.g. holiday/puente periods), each above the
   confidence threshold.

## 12. Alternatives considered

- **Absolute per-gama curves (no index)** — rejected as headline: 16 curves, no single message, still mixes
  route/date within a gama.
- **Strict same-cohort (route×gama×target-week across lead-times)** — rejected: too sparse for a stable curve;
  its spirit is partially captured by 05d's per-target-date view.
- **Mean instead of median** — rejected: the price tail (max 95M COP) makes the mean meaningless.
- **Standalone report** — rejected: duplicates presentation scaffolding; Report 05 in the bundle reuses everything.

## 13. Future work

- If the productive system starts persisting per-quote prices + a stable quote id, this becomes a live,
  refreshable curve and (with a quote↔reservation id) enables the conversion analysis (points 6–9).
- A controlled cohort study (same target observed over time) once volume per target-week is sufficient.
