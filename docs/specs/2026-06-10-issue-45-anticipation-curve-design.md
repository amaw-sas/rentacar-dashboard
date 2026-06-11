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
| Granularity | Normalized **per-day index** (price-per-day ÷ stratum median, stratum = gama × duration-band) + top-gama breakdown | Removes the gama-mix AND the rental-duration confound; gives one national message with rigor |
| Lead-time buckets | Fine near pickup: `0,1,2,3,4-7,8-14,15-30,31-60,61-90,90+` days | Day resolution where booking decisions happen; grouped tail avoids noise |
| Headline metrics | Sweet spot = min-index bucket; urgency = index(≤3d)÷min−1; velocity = index(2d)÷index(4-7d)−1 | Anchored to the directive's own framing |
| Aggregation | **Median** index per bucket (+ p25/p75) | Robust to the 95M-COP price outliers |
| Output | **Report 05** in the existing bundle | Reuses the full reporting + presentation pipeline; reports 01–04 untouched |
| Conversion (points 6-9) | Out of scope | No usable join key (verified) |

## 4. Methodology

> **Correction (2026-06-11).** The first draft indexed on `total_amount`. Verifying over the real Parquet showed
> `total_amount` is the WHOLE-RENTAL price, so the curve was dominated by rental **duration** (longer trips are
> booked further ahead → higher total) plus a spurious 1-day spike from the funnel's "tomorrow, 7-day rental"
> default. The methodology below indexes a **per-day** unit price within a **duration band**, controlling both
> the price-level and the duration confound. The honest corrected curve is a modest ~9% last-minute premium that
> fades by ~1 month — the directive's "+30% urgency" premise is not supported; the actionable signal is per
> target-week (05e) and the disclosed duration/seasonality mix.

**Per-quote normalization (price-level + duration confound).** `total_amount` carries both the gama price level
and the rental length. We index a **per-day unit price** within its `(gama × duration-band)` stratum:
```
rental_days = greatest(datediff('day', cast(pickup_dt as date), cast(return_dt as date)), 1)   -- 1-day minimum
ppd         = total_amount / rental_days
idx         = ppd / median(ppd) OVER (PARTITION BY category_code, dur_band)
```
`idx` is dimensionless and comparable across gamas AND rental lengths. Duration bands (sortable):
`1_1d, 2_2_3d, 3_4_7d, 4_8_14d, 5_15plus`.

**Lead-time.**
```
lead_days = datediff('day', cast(created_at as date), cast(pickup_dt as date))   -- NULL if pickup_dt is NULL
```
Bucketed into the 10 ordered buckets, sortable labels `00_0d, 01_1d, 02_2d, 03_3d, 04_4_7d, 05_8_14d, 06_15_30d,
07_31_60d, 08_61_90d, 09_90plus`.

**Filters (analysis rows).** `lead_days IS NOT NULL`, `lead_days >= 0`, `total_amount > 0`, `category_code` not
null, `return_dt` present and `>= pickup_dt` (so a valid `rental_days` exists). Everything excluded is accounted
for in 05f (§5), including the new `dropped_bad_duration`.

**Fixed-weight pooled curve (composition confound).** A naive `median(idx)` pooled over all strata is still
confounded: *which* `(gama × dur_band)` strata populate a bucket varies by lead-time, so the pooled median mixes
the lead-time effect with composition (gama-mix AND duration-mix). The global curve therefore uses **fixed strata
weights**, **renormalized per bucket over the strata actually present** so missing cells never bias it:
```
present(b) = { strata : n_quotes(strata, b) >= 1 }                   -- (gama,dur_band) with a quote in bucket b
curve(b)   = Σ_{s ∈ present(b)} w_s·median_idx(s,b)
             ───────────────────────────────────────                -- renormalized over present strata
                    Σ_{s ∈ present(b)} w_s
w_s        = n_quotes(strata) / Σ_ALL n_quotes                       -- base weight, CONSTANT across buckets
```
The base `w_s` is constant across buckets (so composition cannot shift the curve), but each bucket renormalizes
over the strata present in it. For readability the curve is **published at `(dur_band × lead_bucket)` granularity**
in cut 05c (`band_idx` + `band_weight`), from which the global curve is exactly reproducible
(`curve(b) = Σ_band band_idx·band_weight / Σ_band band_weight`) — see SCEN-2.

**Aggregation outputs.** Per bucket (05a): `n_quotes`, `weighted_median_idx` (= `curve(b)`), and for spread the
volume-pooled `p25_idx`/`p75_idx`. **Headline index (chart-safe), rebased on the cheapest CONFIDENT bucket:**
```
confident = { b : n_quotes(b) >= 1000 }
base      = min_{b ∈ confident} curve(b)                              -- a thin/noisy tail can NEVER be the base
index_100 = round( curve(b) / base * 100 )                           -- integer: 100 at the sweet spot, e.g. 141
```
`index_100` is an **integer** (100, 105, 141 …) so the integer-only chart label path renders it faithfully (§6);
the decimal `weighted_median_idx` stays in the table. `sweet_spot_bucket` (05b) is the argmin over `confident`
buckets — never a low-confidence one.

**Low-confidence flagging.** Any bucket / cat×bucket / target-week with `n_quotes < 1000` carries a
`low_confidence` flag (rendered, not hidden) and is excluded from `base`/`sweet_spot` selection.

## 5. Report cuts (DuckDB over Parquet, pattern of reports/01–04)

`reports/05-anticipation.sql` runs over `cat_quotes.parquet` JOIN `search_flat.parquet` on `sf.id = cq.search_id`.
Cuts (each a DuckDB `-markdown` result set with the `--- 05x: … ---` marker, like the merged reports):

- **05a — global per-day anticipation curve.** Columns: `lead_bucket, n_quotes, weighted_median_idx, p25_idx,
  p75_idx, index_100, low_confidence`. One row per bucket, ordered by the sortable label. `weighted_median_idx`
  is the per-bucket-renormalized fixed-weight per-day curve (§4); `index_100` rebases on the cheapest *confident*
  bucket (= 100). The headline curve.
- **05b — actionable metrics (one row), each pinned to a NAMED 05a bucket so it is recomputable from 05a:**
  `sweet_spot_bucket` (argmin `weighted_median_idx` over `n_quotes ≥ 1000` buckets), `sweet_spot_index_100`
  (= 100), `urgency_3d_pct = index_100(03_3d) − 100` (the **`03_3d`** bucket, not a pooled ≤3d),
  `velocity_7to2_pct = round((curve(02_2d)/curve(04_4_7d) − 1)·100)` (the **`02_2d`** vs **`04_4_7d`** buckets;
  `04_4_7d` is the 7-day reference since there is no exact 7d bucket — stated explicitly), `n_quotes_total`.
- **05c — curve inputs per `(dur_band × lead_bucket)`.** Per `(dur_band, lead_bucket)`: `n_quotes`, `band_idx`
  (the band's renormalized per-day index), `band_weight` (the constant present-strata weight). This is the grid
  that feeds 05a's curve — `curve(b) = Σ_band band_idx·band_weight / Σ_band band_weight` — so SCEN-2 reproduces
  05a exactly from this cut. (A compact backing table, 5×10 rows.)
- **05d — per-gama actionable summary (top 6 by n_quotes).** `category_code, category_description,
  sweet_spot_bucket, min_median_ppd` (COP/day), `pct_increase_at_3d`. Each gama's own per-day curve (its duration
  bands pooled with fixed within-gama weights); drives the per-gama `hbar` chart + narrative; top-6 for readability.
- **05e — target dates that escalate fastest (point 2).** Per ISO `pickup_week`: `n_searches` (demand) and
  `escalation_pct = round((curve_week(03_3d) / curve_week(06_15_30d) − 1)·100)` using the same per-day fixed
  strata weights renormalized within the week, ranked desc, top 30 over confident weeks (`n_searches ≥ 1000`).
  Surfaces holidays/puentes for inventory + Ads.
- **05f — reconciliation, six mutually-exclusive counts (five drop reasons + the analyzed count, in this precedence).**
  Starting from total priced `cat_quotes` = 2,974,126: `dropped_null_lead` (parent search `pickup_dt`
  NULL/unparseable → `lead_days` NULL), then `dropped_negative_lead` (`lead_days < 0`), then `dropped_null_price`
  (`total_amount` IS NULL OR `<= 0`), then `dropped_null_category` (`category_code` NULL), then
  `dropped_bad_duration` (`return_dt` NULL or before pickup → no valid `rental_days`), then `n_quotes_analyzed`
  (= Σ 05a buckets). The six counts MUST sum to exactly 2,974,126. (All four amount/date inputs are NULLABLE in
  `materialize.sql`, so each drop reason is tallied, not assumed zero.)

`generate-reports.sh` is extended to run `05-anticipation.sql` and append its block to the committed bundle,
exactly as it does for 01–04 (same `SET VARIABLE dataset_dir`, atomic publish, PII-free markdown).

## 6. Presentation (reuse the merged PDF/Markdown pipeline)

- `narrative.es.md`: a new `<!-- NARRATIVE: 05 -->` block, heading **"Anticipación de precios"** (Spanish, run
  through `/humanizer`), citing the real 05b figures (sweet spot, +% at 3d, 7→2 velocity) once computed.
- `compose-html.mjs` / `compose-markdown.mjs`: add `"05"` to `REPORT_ORDER` and `REPORT_CUTS`
  (`["05a","05b","05c","05d","05e","05f"]`); add report-05 charts.
- **Charts (§6 of the parent spec):** Report 05 → `line(05a → x = lead_bucket far→near, y = index_100)` (the
  curve — `index_100` is an **integer** 100…150, so the existing integer-only `fmtInt` label path renders it
  faithfully; plotting the decimal `weighted_median_idx` would collapse every label to "1"/"2" and is NOT used)
  + `hbar(05d per-gama → value = pct_increase_at_3d)` (already integer-percent). No change to `charts.mjs`; its
  integer-only / IPv4-guard invariants are preserved.
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
| 05f does not reconcile | report is wrong — investigate, do not publish |
| Negative/null lead-time or price | excluded by filter, counted in 05f's dropped tally |

## 9. File structure

```
scripts/analysis/log-veh/
  reports/05-anticipation.sql      # NEW — cuts 05a–05f
  generate-reports.sh              # MODIFIED — add 5th entry to REPORT_FILES/REPORT_TITLES arrays
  pdf/narrative.es.md              # MODIFIED — + NARRATIVE 05 block (humanized)
  pdf/parse-bundle.mjs             # MODIFIED — MANIFEST += ["05","05a"]…["05","05f"] (else 05 cuts are unguarded)
  pdf/compose-html.mjs             # MODIFIED — REPORT_ORDER += "05"; REPORT_CUTS["05"]=["05a"…"05f"];
                                   #   TEXT_COLUMNS += lead_bucket, pickup_week, low_confidence; new chartsFor("05")
  pdf/compose-markdown.mjs         # MODIFIED — REPORT_ORDER += "05"; REPORT_CUTS["05"]=["05a"…"05f"]; TEXT_COLUMNS += same
docs/specs/2026-06-10-issue-45-anticipation-curve/scenarios/*.scenarios.md   # holdout
docs/data-ops/.../reports/log-veh-reports-<date>.md   # the committed bundle gains a Report 05 section
```
Reports 01–04 SQL and the `render-pdf.sh`/`render-markdown.sh` orchestrators are untouched (they render whatever
the composers emit). `charts.mjs` is untouched. The Parquet stays gitignored.

**Blast radius (consumers):** `parse-bundle.mjs`'s `MANIFEST` is a hardcoded list of expected `(report, cut)`
pairs asserted present at parse time — it MUST gain the five 05 cuts or they are parsed-but-unguarded (a missing
05 cut would pass silently). `compose-html.mjs`/`compose-markdown.mjs` drive table ordering from `REPORT_CUTS`,
column alignment from `TEXT_COLUMNS`, and charts from a hardcoded `chartsFor` if-chain — all three need the 05
additions. No other consumer reads the bundle.

## 10. Testing strategy

- **Report correctness (DuckDB execution):** run `05-anticipation.sql` over the regenerated Parquet; assert
  05f reconciles; assert the curve is monotone-ish (median_idx non-decreasing as lead-time shrinks past the
  sweet spot is expected but NOT forced — if it isn't, that's a real finding, not a bug); assert 05b's metrics
  equal the values derivable from 05a.
- **Presentation (unit, vitest):** `compose-html`/`compose-markdown` include the Report 05 heading + its chart;
  determinism preserved; `parse-bundle` parses 05a–05f AND its `MANIFEST` now includes the six 05 cuts (a
  bundle missing any 05 cut throws — extend the existing missing-cut test).
- **End-to-end:** `render-pdf.sh` / `render-markdown.sh` produce `%PDF`/Markdown with the new section; check-pii
  passes; determinism holds.

## 11. Observable scenarios (holdout for SDD)

1. **Curve produced (structural smoke check)** — `05-anticipation.sql` over the Parquet yields cut 05a with all
   10 ordered buckets present, each with `n_quotes`, `weighted_median_idx`, and an integer `index_100` whose
   minimum equals exactly `100` (rebasing arithmetic). This proves the pipeline ran end-to-end; the analytical
   value is the reported numbers, whose *direction is not pre-judged* (the curve is whatever the data says).
2. **Curve is the renormalized fixed-weight average, reproducible from 05c** — recomputing
   `curve(b) = Σ_{cat present in b} w_cat·median_idx(cat,b) / Σ_{cat present in b} w_cat` from cut **05c** (which
   exposes every category's `median_idx` + `w_cat` per bucket) reproduces 05a's `weighted_median_idx` exactly.
   Because `w_cat` is constant across buckets, gama composition cannot shift the curve (this removes the
   composition confound, not just the level one).
3. **Missing cells renormalize, never bias** — for a bucket where some categories have zero quotes, 05a's curve
   uses only the present categories with their weights renormalized to sum to 1 (verifiable: take a bucket with a
   known-absent gama; its `weighted_median_idx` equals the present-only renormalized sum, and equals what 05c
   reproduces — it is NOT dragged toward 0).
4. **Metrics derive from NAMED, CONFIDENT 05a buckets** — 05b's `sweet_spot_bucket` is the argmin
   `weighted_median_idx` over buckets with `n_quotes ≥ 1000` (never a low-confidence bucket); `urgency_3d_pct`
   equals 05a's `index_100` at **`03_3d`** minus 100; `velocity_7to2_pct` equals
   `round((curve(02_2d)/curve(04_4_7d) − 1)·100)` from 05a's named buckets. Each recomputable from 05a.
5. **Reconciliation (five mutually-exclusive counts)** — 05f: `dropped_null_lead + dropped_negative_lead +
   dropped_null_price + dropped_null_category + n_quotes_analyzed` = exactly `2,974,126`; no quote silently lost
   or double-counted.
6. **Robustness + confident rebasing** — aggregation uses median (a single 95M-COP outlier does not move a
   bucket's value); `index_100`'s base is the cheapest bucket with `n_quotes ≥ 1000`, so a thin noisy tail can
   never become the rebasing base; buckets / cat×buckets / weeks with `n_quotes < 1000` carry `low_confidence`.
7. **Report 05 in the bundle + presentation** — the committed markdown bundle gains a Report 05 section; the
   parser's `MANIFEST` includes 05a–05f (a missing 05 cut throws); the composed HTML/Markdown contains the
   **"Anticipación de precios"** heading, the curve `line` chart (faithful integer `index_100` label, a 3-digit
   value ≥ 100), and the per-gama `hbar`; PDF renders (`%PDF`), check-pii passes, determinism holds.
8. **Target-date escalation (point 2)** — 05e ranks pickup-weeks by `escalation_pct` desc and reports each
   week's `n_searches`; every reported top row is above the `n_searches ≥ 1000` confidence threshold (which
   weeks rank highest is a data finding, not asserted).

## 12. Alternatives considered

- **Absolute per-gama curves (no index)** — rejected as headline: 16 curves, no single message, still mixes
  route/date within a gama.
- **Strict same-cohort (route×gama×target-week across lead-times)** — rejected: too sparse for a stable curve;
  its spirit is partially captured by 05e's per-target-date view.
- **Mean instead of median** — rejected: the price tail (max 95M COP) makes the mean meaningless.
- **Standalone report** — rejected: duplicates presentation scaffolding; Report 05 in the bundle reuses everything.

## 13. Future work

- If the productive system starts persisting per-quote prices + a stable quote id, this becomes a live,
  refreshable curve and (with a quote↔reservation id) enables the conversion analysis (points 6–9).
- A controlled cohort study (same target observed over time) once volume per target-week is sufficient.
