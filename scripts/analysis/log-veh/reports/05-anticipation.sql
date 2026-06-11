-- 05-anticipation.sql — DuckDB over the Parquet snapshot.
--
-- Report 05: price vs booking anticipation (lead time). Directive points 1-3 — the
-- "sweet spot" lead time, the urgency near pickup, and the 7d->2d velocity.
--
-- METHODOLOGY (see docs/specs/2026-06-10-issue-45-anticipation-curve-design.md §4).
-- Two confounds are controlled, because total_amount is the WHOLE-RENTAL price:
--   1. PRICE LEVEL + DURATION  — total_amount scales with both the gama and the rental
--      length. We index a PER-DAY unit price within (gama × duration-band):
--         ppd = total_amount / rental_days
--         idx = ppd / median(ppd) OVER (category_code, dur_band)
--      idx is dimensionless and comparable across gamas AND rental lengths. Indexing on
--      total_amount (an earlier design) produced a curve dominated by duration — longer
--      trips are booked further ahead — and a spurious spike at 1-day lead driven by the
--      funnel's "tomorrow, 7-day rental" default. Per-day, duration-banded removes both.
--   2. COMPOSITION  — which (gama × dur_band) strata populate a lead bucket varies by lead
--      time. The global curve uses FIXED strata weights w = n(strata)/N, CONSTANT across
--      lead buckets, renormalized per bucket over the strata actually present, so neither
--      gama-mix nor duration-mix shifts the curve and missing cells never bias it toward 0.
--      The curve is published at (dur_band × lead_bucket) granularity in 05c and is exactly
--      reproducible from it.
--   index_100 = round(curve(b)/base·100), base = min curve over n>=1000 buckets. Integer,
--   chart-safe; 100 at the cheapest CONFIDENT bucket. Aggregation is MEDIAN (quantile_cont),
--   robust to the 95M-COP price tail.
--
-- Joins cat_quotes.parquet to search_flat.parquet on sf.id = cq.search_id. The inner join
-- is exactly 2,974,126 rows (cat_quotes FK integrity), so 05f reconciles the full corpus.
-- total_amount / pickup_dt / category_code / return_dt are all NULLABLE, so 05f tallies five
-- mutually-exclusive drop reasons (incl. missing/invalid rental duration), not assumed zero.
--
-- PII-free: reads only PII-free columns. Deterministic: explicit ORDER BY with stable
-- tie-breaks, no clock/random. Temp tables are silent in DuckDB -markdown (verified) so they
-- do not pollute the bundle.
SET VARIABLE dataset_dir = coalesce(
  getvariable('dataset_dir'),
  'scripts/analysis/log-veh/dataset'
);

SELECT '=== REPORT 05: anticipation curve (per-day price vs booking lead time) ===' AS section;

-- ---------------------------------------------------------------------------
-- Shared intermediates (temp tables; silent in -markdown). Built once, read by all cuts.
-- ---------------------------------------------------------------------------

-- j : the full join (exactly 2,974,126 rows) — the reconciliation base (05f).
-- lead_days and rental days are date-based (time-of-day ignored), consistent with each other.
CREATE TEMP TABLE j AS
SELECT
  cq.search_id,
  cq.category_code,
  cq.category_description,
  cq.total_amount,
  sf.pickup_dt,
  sf.return_dt,
  datediff('day', CAST(sf.created_at AS DATE), CAST(sf.pickup_dt AS DATE)) AS lead_days,
  datediff('day', CAST(sf.pickup_dt AS DATE), CAST(sf.return_dt AS DATE))  AS rental_days_raw
FROM read_parquet(getvariable('dataset_dir') || '/cat_quotes.parquet') cq
JOIN read_parquet(getvariable('dataset_dir') || '/search_flat.parquet') sf
  ON sf.id = cq.search_id;

-- a : the analysis set (lead-valid, priced, categorized, valid duration) with per-day price,
-- lead bucket, duration band, and pickup ISO-week. rental_days floors at 1 (same-day return =
-- one rental day; the 1-day minimum charge), so ppd is the per-rental-day unit price.
CREATE TEMP TABLE a AS
SELECT
  search_id,
  category_code,
  category_description,
  total_amount,
  GREATEST(rental_days_raw, 1)                          AS rental_days,
  total_amount / GREATEST(rental_days_raw, 1)           AS ppd,
  strftime(pickup_dt, '%G-W%V')                         AS pickup_week,
  CASE
    WHEN lead_days = 0                  THEN '00_0d'
    WHEN lead_days = 1                  THEN '01_1d'
    WHEN lead_days = 2                  THEN '02_2d'
    WHEN lead_days = 3                  THEN '03_3d'
    WHEN lead_days BETWEEN 4 AND 7      THEN '04_4_7d'
    WHEN lead_days BETWEEN 8 AND 14     THEN '05_8_14d'
    WHEN lead_days BETWEEN 15 AND 30    THEN '06_15_30d'
    WHEN lead_days BETWEEN 31 AND 60    THEN '07_31_60d'
    WHEN lead_days BETWEEN 61 AND 90    THEN '08_61_90d'
    ELSE '09_90plus'
  END AS lead_bucket,
  CASE
    WHEN rental_days_raw <= 1           THEN '1_1d'
    WHEN rental_days_raw BETWEEN 2 AND 3   THEN '2_2_3d'
    WHEN rental_days_raw BETWEEN 4 AND 7   THEN '3_4_7d'
    WHEN rental_days_raw BETWEEN 8 AND 14  THEN '4_8_14d'
    ELSE '5_15plus'
  END AS dur_band
FROM j
WHERE lead_days IS NOT NULL
  AND lead_days >= 0
  AND total_amount > 0
  AND category_code IS NOT NULL
  AND return_dt IS NOT NULL
  AND CAST(return_dt AS DATE) >= CAST(pickup_dt AS DATE);

-- strata : per (category × duration band) — the per-day normalization median + the count
-- that fixes the constant weight. This single partition removes gama-level AND duration-level.
CREATE TEMP TABLE strata AS
SELECT
  category_code,
  dur_band,
  quantile_cont(ppd, 0.5) AS med_ppd,
  COUNT(*)                AS n_strata
FROM a
GROUP BY category_code, dur_band;

-- ai : per-quote per-day index (level + duration normalized).
CREATE TEMP TABLE ai AS
SELECT
  a.category_code,
  a.dur_band,
  a.lead_bucket,
  a.pickup_week,
  a.ppd,
  a.ppd / s.med_ppd AS idx
FROM a
JOIN strata s ON s.category_code = a.category_code AND s.dur_band = a.dur_band;

-- w : the CONSTANT strata weight w = n(strata) / N (sums to 1 over all strata).
CREATE TEMP TABLE w AS
SELECT
  category_code,
  dur_band,
  n_strata,
  n_strata::DOUBLE / SUM(n_strata) OVER () AS w_strata
FROM strata;

-- cell : the deepest grid — per (category × dur_band × lead_bucket): median per-day index + n.
CREATE TEMP TABLE cell AS
SELECT
  ai.category_code,
  ai.dur_band,
  ai.lead_bucket,
  COUNT(*)                  AS n_quotes,
  quantile_cont(ai.idx, 0.5) AS median_idx
FROM ai
GROUP BY ai.category_code, ai.dur_band, ai.lead_bucket;

-- band : the curve published at (dur_band × lead_bucket). band_weight is the sum of the
-- present strata weights (so the global pool renormalizes); band_idx is the band's own
-- renormalized per-day index. The global curve is Σ band_idx·band_weight / Σ band_weight.
CREATE TEMP TABLE band AS
SELECT
  c.dur_band,
  c.lead_bucket,
  SUM(c.n_quotes)                              AS n_quotes,
  SUM(w.w_strata * c.median_idx)               AS band_contrib,   -- Σ w·median_idx (present gamas)
  SUM(w.w_strata)                              AS band_weight,    -- Σ w (present gamas)
  SUM(w.w_strata * c.median_idx) / SUM(w.w_strata) AS band_idx    -- the band's renormalized curve
FROM cell c
JOIN w ON w.category_code = c.category_code AND w.dur_band = c.dur_band
GROUP BY c.dur_band, c.lead_bucket;

-- curve : the global anticipation curve — fixed strata weights renormalized per bucket.
CREATE TEMP TABLE curve AS
SELECT
  lead_bucket,
  SUM(band_contrib) / SUM(band_weight) AS weighted_median_idx,
  SUM(n_quotes)                        AS n_quotes
FROM band
GROUP BY lead_bucket;

-- spread : volume-pooled p25/p75 of the per-day index per bucket (dispersion, not weighted).
CREATE TEMP TABLE spread AS
SELECT
  lead_bucket,
  quantile_cont(idx, 0.25) AS p25_idx,
  quantile_cont(idx, 0.75) AS p75_idx
FROM ai
GROUP BY lead_bucket;

-- base : the cheapest CONFIDENT bucket's curve value — index_100's denominator.
CREATE TEMP TABLE base AS
SELECT MIN(weighted_median_idx) AS base_idx
FROM curve
WHERE n_quotes >= 1000;

-- ---------------------------------------------------------------------------
-- 05a — global per-day anticipation curve (the headline). One row per lead bucket.
-- ---------------------------------------------------------------------------
SELECT '--- 05a: global per-day anticipation curve (duration-controlled; index_100 rebased on cheapest confident bucket = 100) ---' AS subsection;
SELECT
  c.lead_bucket,
  c.n_quotes,
  CAST(c.weighted_median_idx AS DECIMAL(10,4))               AS weighted_median_idx,
  CAST(s.p25_idx AS DECIMAL(10,4))                           AS p25_idx,
  CAST(s.p75_idx AS DECIMAL(10,4))                           AS p75_idx,
  CAST(round(c.weighted_median_idx / b.base_idx * 100) AS BIGINT) AS index_100,
  CASE WHEN c.n_quotes < 1000 THEN 'true' ELSE 'false' END   AS low_confidence
FROM curve c
JOIN spread s ON s.lead_bucket = c.lead_bucket
CROSS JOIN base b
ORDER BY c.lead_bucket;

-- ---------------------------------------------------------------------------
-- 05b — actionable metrics (one row), each pinned to a NAMED 05a bucket so it is
-- recomputable from 05a. urgency_3d_pct = index_100(03_3d) - 100 (computed identically).
-- ---------------------------------------------------------------------------
SELECT '--- 05b: actionable metrics (sweet spot, urgency at 3d, velocity 7->2; per-day) ---' AS subsection;
SELECT
  (SELECT lead_bucket FROM curve WHERE n_quotes >= 1000
     ORDER BY weighted_median_idx ASC, lead_bucket ASC LIMIT 1)            AS sweet_spot_bucket,
  100                                                                       AS sweet_spot_index_100,
  CAST(round((SELECT weighted_median_idx FROM curve WHERE lead_bucket = '03_3d')
             / (SELECT base_idx FROM base) * 100) - 100 AS BIGINT)          AS urgency_3d_pct,
  CAST(round(((SELECT weighted_median_idx FROM curve WHERE lead_bucket = '02_2d')
              / (SELECT weighted_median_idx FROM curve WHERE lead_bucket = '04_4_7d')
              - 1) * 100) AS BIGINT)                                        AS velocity_7to2_pct,
  (SELECT SUM(n_quotes) FROM curve)                                         AS n_quotes_total;

-- ---------------------------------------------------------------------------
-- 05c — the curve published at (dur_band × lead_bucket). Reproduces 05a exactly:
-- weighted_median_idx(b) = Σ_d band_idx·band_weight / Σ_d band_weight (SCEN-002).
-- band_weight is the constant present-strata weight; band_idx the band's per-day curve.
-- ---------------------------------------------------------------------------
SELECT '--- 05c: curve inputs per (duration band × lead bucket); feeds 05a ---' AS subsection;
SELECT
  dur_band,
  lead_bucket,
  n_quotes,
  CAST(band_idx AS DECIMAL(10,4))    AS band_idx,
  CAST(band_weight AS DECIMAL(12,10)) AS band_weight,
  CASE WHEN n_quotes < 1000 THEN 'true' ELSE 'false' END AS low_confidence
FROM band
ORDER BY dur_band ASC, lead_bucket ASC;

-- ---------------------------------------------------------------------------
-- 05d — per-gama actionable summary (top 6 by n quotes). Each gama's own per-day curve
-- (its duration bands pooled with fixed within-gama weights), the cheapest typical per-day
-- price (COP/day), and how far the 3d-out per-day price sits above that gama's sweet spot.
-- Per-gama sweet spot uses only that gama's CONFIDENT (n>=1000) buckets.
-- ---------------------------------------------------------------------------
SELECT '--- 05d: per-gama summary (top 6 by volume): sweet spot + min median price/day + %@3d ---' AS subsection;
WITH gtot AS (  -- total quotes per gama: ranks top6 AND sets the within-gama duration weights
  SELECT category_code, SUM(n_strata) AS n_gama FROM strata GROUP BY category_code
),
top6 AS (
  SELECT g.category_code, d.category_description, g.n_gama AS n_cat
  FROM gtot g
  JOIN (SELECT category_code, MIN(category_description) AS category_description FROM a GROUP BY category_code) d
    ON d.category_code = g.category_code
  ORDER BY g.n_gama DESC, g.category_code ASC
  LIMIT 6
),
gcurve AS (  -- per (gama × lead_bucket): pool the gama's duration bands with fixed within-gama weights
  SELECT
    c.category_code, c.lead_bucket,
    SUM((s.n_strata::DOUBLE / g.n_gama) * c.median_idx) / SUM(s.n_strata::DOUBLE / g.n_gama) AS gama_idx,
    SUM(c.n_quotes) AS n_quotes
  FROM cell c
  JOIN strata s ON s.category_code = c.category_code AND s.dur_band = c.dur_band
  JOIN gtot g   ON g.category_code = c.category_code
  GROUP BY c.category_code, c.lead_bucket
),
gconf AS (SELECT * FROM gcurve WHERE n_quotes >= 1000),
gss AS (  -- per-gama sweet spot = argmin gama_idx over confident buckets
  SELECT category_code, lead_bucket AS sweet_spot_bucket, gama_idx AS ss_idx,
         ROW_NUMBER() OVER (PARTITION BY category_code ORDER BY gama_idx ASC, lead_bucket ASC) AS rn
  FROM gconf
),
gat3 AS (SELECT category_code, gama_idx AS idx_3d FROM gcurve WHERE lead_bucket = '03_3d')
SELECT
  t.category_code,
  t.category_description,
  gss.sweet_spot_bucket,
  CAST(gp.min_median_ppd AS DECIMAL(16,2))                    AS min_median_ppd,
  -- COALESCE guard: g3.idx_3d is non-null for the top-6 (dense 3d bucket), but if a future
  -- thinner gama lacked a 03_3d cell the LEFT JOIN would yield NULL → the chart's numAt would
  -- throw and abort the whole render. 0 = "no measurable 3d premium" is a safe sentinel.
  COALESCE(CAST(round((g3.idx_3d / gss.ss_idx - 1) * 100) AS BIGINT), 0) AS pct_increase_at_3d
FROM top6 t
JOIN gss ON gss.category_code = t.category_code AND gss.rn = 1
JOIN (
  SELECT category_code, MIN(med_ppd_bucket) AS min_median_ppd FROM (
    SELECT category_code, lead_bucket, quantile_cont(ppd, 0.5) AS med_ppd_bucket, COUNT(*) AS nq
    FROM a GROUP BY category_code, lead_bucket
  ) WHERE nq >= 1000 GROUP BY category_code
) gp ON gp.category_code = t.category_code
LEFT JOIN gat3 g3 ON g3.category_code = t.category_code
ORDER BY t.n_cat DESC, t.category_code ASC;

-- ---------------------------------------------------------------------------
-- 05e — target dates that escalate fastest (point 2). Per ISO pickup week, the per-day
-- curve at 3 days vs 15-30 days out (same fixed strata weights, renormalized within week).
-- Top 30 by escalation, restricted to confident weeks (n_searches >= 1000).
-- ---------------------------------------------------------------------------
SELECT '--- 05e: target weeks ranked by per-day price escalation (3d vs 15-30d), top 30 confident ---' AS subsection;
WITH wcell AS (  -- per week × strata × the two buckets: median per-day index
  SELECT pickup_week, category_code, dur_band, lead_bucket, quantile_cont(idx, 0.5) AS median_idx
  FROM ai
  WHERE lead_bucket IN ('03_3d', '06_15_30d')
  GROUP BY pickup_week, category_code, dur_band, lead_bucket
),
wcurve AS (  -- renormalized fixed-weight per-day curve per week × bucket
  SELECT
    c.pickup_week, c.lead_bucket,
    SUM(w.w_strata * c.median_idx) / SUM(w.w_strata) AS curve_week
  FROM wcell c
  JOIN w ON w.category_code = c.category_code AND w.dur_band = c.dur_band
  GROUP BY c.pickup_week, c.lead_bucket
),
piv AS (
  SELECT
    pickup_week,
    MAX(CASE WHEN lead_bucket = '03_3d'     THEN curve_week END) AS c3,
    MAX(CASE WHEN lead_bucket = '06_15_30d' THEN curve_week END) AS c15
  FROM wcurve GROUP BY pickup_week
),
nse AS (  -- demand: distinct searches in the analysis set per pickup week
  SELECT pickup_week, COUNT(DISTINCT search_id) AS n_searches
  FROM a GROUP BY pickup_week
)
SELECT
  p.pickup_week,
  n.n_searches,
  CAST(round((p.c3 / p.c15 - 1) * 100) AS BIGINT)            AS escalation_pct,
  CASE WHEN n.n_searches < 1000 THEN 'true' ELSE 'false' END AS low_confidence
FROM piv p
JOIN nse n ON n.pickup_week = p.pickup_week
WHERE p.c3 IS NOT NULL
  AND p.c15 IS NOT NULL
  AND n.n_searches >= 1000
ORDER BY escalation_pct DESC, p.pickup_week ASC
LIMIT 30;

-- ---------------------------------------------------------------------------
-- 05f — reconciliation. Six mutually-exclusive counts (5 drop reasons in precedence +
-- the analyzed count) MUST sum to exactly 2,974,126. n_quotes_analyzed = Σ 05a n_quotes.
-- ---------------------------------------------------------------------------
SELECT '--- 05f: reconciliation (6 mutually-exclusive counts sum to cat_quotes = 2,974,126) ---' AS subsection;
SELECT
  COUNT(*) FILTER (WHERE lead_days IS NULL)
    AS dropped_null_lead,
  COUNT(*) FILTER (WHERE lead_days IS NOT NULL AND lead_days < 0)
    AS dropped_negative_lead,
  COUNT(*) FILTER (WHERE lead_days IS NOT NULL AND lead_days >= 0
                     AND (total_amount IS NULL OR total_amount <= 0))
    AS dropped_null_price,
  COUNT(*) FILTER (WHERE lead_days IS NOT NULL AND lead_days >= 0
                     AND total_amount > 0 AND category_code IS NULL)
    AS dropped_null_category,
  COUNT(*) FILTER (WHERE lead_days IS NOT NULL AND lead_days >= 0
                     AND total_amount > 0 AND category_code IS NOT NULL
                     AND (return_dt IS NULL OR CAST(return_dt AS DATE) < CAST(pickup_dt AS DATE)))
    AS dropped_bad_duration,
  COUNT(*) FILTER (WHERE lead_days IS NOT NULL AND lead_days >= 0
                     AND total_amount > 0 AND category_code IS NOT NULL
                     AND return_dt IS NOT NULL AND CAST(return_dt AS DATE) >= CAST(pickup_dt AS DATE))
    AS n_quotes_analyzed,
  COUNT(*) AS total_quotes
FROM j;
