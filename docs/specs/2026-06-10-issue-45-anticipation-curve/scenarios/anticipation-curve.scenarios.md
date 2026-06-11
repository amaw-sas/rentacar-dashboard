---
name: anticipation-curve
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-10T00:00:00Z
amended_at: 2026-06-11T00:00:00Z
spec: docs/specs/2026-06-10-issue-45-anticipation-curve-design.md
issue: 45
phase: anticipation-curve
---

# Scenarios — log_veh anticipation-curve analysis (Report 05)

Holdout contract for the price-vs-booking-anticipation analysis (directive points 1–3), added as **Report 05**
to the merged log_veh bundle. **No scenario asserts a directional analytical result** (whether price rises toward
pickup, where the sweet spot lands) — those are data findings the report reveals, not contract.

> **Amendment (2026-06-11) — methodology correction, not output-fitting.** The first design indexed on
> `total_amount`. Implementation verification over the real Parquet showed `total_amount` is the WHOLE-RENTAL
> price, so the curve was dominated by rental **duration** (longer trips are booked further ahead) plus a spurious
> 1-day spike from the funnel's "tomorrow, 7-day rental" default. The corrected methodology indexes a **per-day**
> unit price within a **duration band** (below). This tightens the invariants; it does **not** weaken them to match
> output — the corrected headline (a modest ~9% last-minute premium) is *less* dramatic than the confounded one,
> the opposite of reward-hacking. Directional findings remain unasserted.

Methodology (the load-bearing invariants):
- Per-day unit price `ppd = total_amount / rental_days` (rental_days floored at 1), indexed within its stratum:
  `idx = ppd / median(ppd) PARTITION BY (category_code, dur_band)` — removes the gama **price-level** AND the
  **duration-level** confound (both move `total_amount`).
- The global curve is a **fixed-weight average renormalized per bucket** over `(category × dur_band)` strata:
  `curve(b) = Σ_{strata∈present(b)} w·median_idx(strata,b) / Σ_{strata∈present(b)} w`, `w = n(strata)/N`
  constant across lead buckets — removes the **composition** confound (gama-mix AND duration-mix) and never biases
  on missing cells. It is published at `(dur_band × lead_bucket)` granularity in 05c and reproducible from it.
- `index_100 = round(curve(b)/base·100)` with `base = min curve over n≥1000 buckets` (integer; chart-safe).
- 10 ordered lead buckets: `00_0d, 01_1d, 02_2d, 03_3d, 04_4_7d, 05_8_14d, 06_15_30d, 07_31_60d, 08_61_90d,
  09_90plus`. 5 duration bands: `1_1d, 2_2_3d, 3_4_7d, 4_8_14d, 5_15plus`. Aggregation uses median (robust to
  the 95M-COP price tail).

Validation surface: real DuckDB execution over the Parquet for the SQL; vitest for the composer integration;
real `render-*`/`check-pii` for the end-to-end.

---

## SCEN-001: curve produced (structural smoke check)

**Given**: the regenerated Parquet dataset.
**When**: `05-anticipation.sql` runs cut 05a.
**Then**: 05a has all 10 lead buckets present, each with `n_quotes`, a per-day `weighted_median_idx`, and an
**integer** `index_100`; the minimum `index_100` over confident (`n_quotes ≥ 1000`) buckets equals exactly `100`.
(Pipeline ran end-to-end; the curve's *direction* is not asserted — whatever the data says.)
**Evidence**: DuckDB output of 05a shows 10 ordered bucket rows; `min(index_100 WHERE n_quotes>=1000) = 100`;
every `index_100` value is an integer.

## SCEN-002: global curve is reproducible from the per-band grid (05c)

**Given**: 05a (global curve) and 05c (per-`(dur_band × lead_bucket)` `band_idx` + `band_weight`, all 5 bands).
**When**: for each bucket, `curve(b) = Σ_band band_idx·band_weight / Σ_band band_weight` is recomputed from 05c.
**Then**: the recomputed value equals 05a's `weighted_median_idx(b)` for every bucket (within rounding). Because
`band_weight` derives from strata weights constant across buckets, no high-volume gama or duration can shift the
curve across lead-times.
**Evidence**: a recomputation from the 05c grid matches 05a row-for-row; 05c exposes every duration band present
in the analysis set.

## SCEN-003: missing cells renormalize, never bias toward zero

**Given**: a lead bucket in which at least one `(category × dur_band)` stratum has zero quotes.
**When**: 05a computes that bucket's `weighted_median_idx`.
**Then**: the value equals the present-only renormalized weighted sum (present strata weights summing to the
bucket's `Σ band_weight`) — it is NOT dragged toward 0 by the absent stratum, and is NOT NULL.
**Evidence**: the curve formula `Σ w·median_idx / Σ w` is grouped over present strata only; a synthetic-gap
recomputation (drop one stratum from a bucket) yields the present-only renormalized value, strictly above the
naive sum that omits renormalization, and positive/finite. (On the full dataset every stratum×bucket cell is
populated, so renormalization is a verified no-op there; the synthetic gap evidences the code path.)

## SCEN-004: metrics derive from named, confident 05a buckets

**Given**: 05a and 05b.
**When**: 05b's metrics are recomputed from 05a.
**Then**: `sweet_spot_bucket` is the argmin `weighted_median_idx` over `n_quotes ≥ 1000` buckets (never a
low-confidence bucket); `urgency_3d_pct = index_100(03_3d) − 100`; `velocity_7to2_pct =
round((curve(02_2d)/curve(04_4_7d) − 1)·100)`. Each equals its recomputation from 05a exactly.
**Evidence**: 05b's three figures equal the values derived from 05a's named buckets; `sweet_spot_bucket` has
`n_quotes ≥ 1000`.

## SCEN-005: reconciliation — six mutually-exclusive counts sum to the corpus

**Given**: the full `cat_quotes` (2,974,126 priced quotes).
**When**: cut 05f tallies the drop reasons + analyzed count.
**Then**: `dropped_null_lead + dropped_negative_lead + dropped_null_price + dropped_null_category +
dropped_bad_duration + n_quotes_analyzed = 2,974,126` exactly, with the reasons applied in the spec's precedence
(mutually exclusive). `dropped_bad_duration` counts rows surviving the prior filters whose `return_dt` is NULL or
before pickup (no valid rental length to form `ppd`).
**Evidence**: 05f's six counts sum to `2974126`; `n_quotes_analyzed` equals `Σ n_quotes` over 05a's buckets.

## SCEN-006: robustness — median aggregation + confident rebasing

**Given**: the priced quotes including the 95M-COP price tail.
**When**: 05a aggregates each bucket.
**Then**: the reported per-bucket value is a **median** (a single extreme outlier does not move it), and
`index_100`'s base is the cheapest bucket with `n_quotes ≥ 1000` (a thin noisy tail can never be the base);
buckets / strata×buckets / weeks with `n_quotes < 1000` carry a `low_confidence` flag.
**Evidence**: 05a uses `median`/`quantile_cont` (not `avg`) for the bucket value; the bucket whose `index_100`
is 100 has `n_quotes ≥ 1000`; low-volume rows show `low_confidence = true`.

## SCEN-007: Report 05 lands in the bundle and the presentation

**Given**: the regenerated bundle and the merged PDF/Markdown pipeline.
**When**: `generate-reports.sh` regenerates the bundle and `render-pdf.sh` / `render-markdown.sh` run.
**Then**: the committed markdown bundle contains a `=== REPORT 05` section with cuts 05a–05f;
`parse-bundle.mjs`'s `MANIFEST` includes the six 05 cuts (a bundle missing any 05 cut throws); the composed
HTML/Markdown contains the **"Anticipación de precios"** heading, the curve `line` chart with a faithful
integer `index_100` label (a value ≥ 100), and the per-gama `hbar`; the PDF starts with `%PDF`; `check-pii.sh`
exits 0; HTML/Markdown is byte-identical across two runs.
**Evidence**: the bundle, `report.html`/`report.md`, and PDF all show the Report 05 section + heading + charts;
`check-pii` exit 0; `cmp` of two composer runs is identical; a missing-05-cut bundle makes `parseBundle` throw.

## SCEN-008: target-date escalation (point 2)

**Given**: cut 05e.
**When**: it ranks pickup-weeks by `escalation_pct` descending.
**Then**: each reported top row carries `n_searches` and is above the `n_searches ≥ 1000` confidence threshold
(which weeks rank highest is a data finding, not asserted); `escalation_pct = round((curve_week(03_3d) /
curve_week(06_15_30d) − 1)·100)` using the same renormalized fixed-weight per-day method within the week.
**Evidence**: 05e's top-30 rows each have `n_searches ≥ 1000`; the escalation formula matches the spec.
