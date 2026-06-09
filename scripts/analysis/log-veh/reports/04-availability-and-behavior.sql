-- 04-availability-and-behavior.sql — DuckDB over the Parquet snapshot.
--
-- Report 04: availability per category + booking behavior (lead time, rental duration,
-- one-way vs round-trip).
--
-- Denominators:
--   * availability: pd_kind='array' = 479,402 (searches that returned a category array).
--   * behavior: rp_kind='valid' = 664,126 (each behavior cut's buckets sum to it).
--
-- Bucket boundaries adapted from the Phase 3 analysis-queries.sql cuts 5/6/7/9, expressed
-- here in DAYS via date_diff (Phase 3 used hours; same cut points, day-converted):
--   lead-time  (cut 6): <0, <1, 1-3, 3-7, 7-30, 30-90, >=90 days
--   duration   (cut 7): <=0, <1, 1-3, 3-7, 7-14, 14-30, >=30 days
--   trip-type  (cut 9): one-way vs round-trip (pickup_location <> return_location)
--
-- Reads BOTH parquet (PII-free). NULLIF guards percentage divisions. Deterministic
-- ORDER BY with stable tie-break.
SET VARIABLE dataset_dir = coalesce(
  getvariable('dataset_dir'),
  'scripts/analysis/log-veh/dataset'
);

SELECT '=== REPORT 04: availability + booking behavior ===' AS section;

-- 04a — availability rate per category: searches_with_category / count(pd_kind='array').
-- Denominator = 479,402 (the array-kind search count). availability_rate_pct = how often a
-- category appeared among array-kind searches.
SELECT '--- 04a: availability rate per category (denominator: pd_kind=array = 479,402) ---' AS subsection;
SELECT
  cq.category_code,
  MIN(cq.category_description)                               AS category_description,
  COUNT(DISTINCT cq.search_id)                              AS searches_with_category,
  ROUND(
    100.0 * COUNT(DISTINCT cq.search_id)
    / NULLIF(
        (SELECT COUNT(*) FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
         WHERE pd_kind = 'array'), 0),
    3
  )                                                          AS availability_rate_pct
FROM read_parquet(getvariable('dataset_dir') || '/cat_quotes.parquet') cq
GROUP BY cq.category_code
ORDER BY searches_with_category DESC, cq.category_code ASC;

-- 04b — lead-time buckets: date_diff('day', created_at, pickup_dt). Denominator rp_kind='valid'
-- = 664,126; the 'z_unparseable_or_null' bucket keeps the cut summing to the denominator.
SELECT '--- 04b: lead-time buckets (denominator: rp_kind=valid = 664,126) ---' AS subsection;
SELECT bucket, COUNT(*) AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM (
  SELECT CASE
    WHEN pickup_dt IS NULL OR created_at IS NULL THEN 'z_unparseable_or_null'
    WHEN date_diff('day', created_at, pickup_dt) < 0   THEN '00_negative'
    WHEN date_diff('day', created_at, pickup_dt) < 1   THEN '01_lt_1d'
    WHEN date_diff('day', created_at, pickup_dt) < 3   THEN '02_1_3d'
    WHEN date_diff('day', created_at, pickup_dt) < 7   THEN '03_3_7d'
    WHEN date_diff('day', created_at, pickup_dt) < 30  THEN '04_7_30d'
    WHEN date_diff('day', created_at, pickup_dt) < 90  THEN '05_30_90d'
    ELSE '06_gte_90d'
  END AS bucket
  FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
  WHERE rp_kind = 'valid'
) t
GROUP BY bucket
ORDER BY bucket ASC;

-- 04c — rental-duration buckets: date_diff('day', pickup_dt, return_dt). Denominator rp_kind='valid' = 664,126.
SELECT '--- 04c: rental-duration buckets (denominator: rp_kind=valid = 664,126) ---' AS subsection;
SELECT bucket, COUNT(*) AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM (
  SELECT CASE
    WHEN pickup_dt IS NULL OR return_dt IS NULL THEN 'z_unparseable_or_null'
    WHEN date_diff('day', pickup_dt, return_dt) <= 0  THEN '00_non_positive'
    WHEN date_diff('day', pickup_dt, return_dt) < 1   THEN '01_lt_1d'
    WHEN date_diff('day', pickup_dt, return_dt) < 3   THEN '02_1_3d'
    WHEN date_diff('day', pickup_dt, return_dt) < 7   THEN '03_3_7d'
    WHEN date_diff('day', pickup_dt, return_dt) < 14  THEN '04_7_14d'
    WHEN date_diff('day', pickup_dt, return_dt) < 30  THEN '05_14_30d'
    ELSE '06_gte_30d'
  END AS bucket
  FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
  WHERE rp_kind = 'valid'
) t
GROUP BY bucket
ORDER BY bucket ASC;

-- 04d — one-way vs round-trip. Denominator rp_kind='valid' = 664,126. NULL-safe equality
-- (IS NOT DISTINCT FROM) so two NULL locations count as round_trip (matches Phase 3 cut 9 <=>).
SELECT '--- 04d: one-way vs round-trip (denominator: rp_kind=valid = 664,126) ---' AS subsection;
SELECT
  CASE WHEN pickup_location IS NOT DISTINCT FROM return_location THEN 'round_trip' ELSE 'one_way' END AS trip_type,
  COUNT(*)                                                  AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3)        AS pct
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
WHERE rp_kind = 'valid'
GROUP BY trip_type
ORDER BY searches DESC, trip_type ASC;

-- 04e — reconciliation anchors.
SELECT '--- 04e: reconciliation (array denom + valid denom) ---' AS subsection;
SELECT
  (SELECT COUNT(*) FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet') WHERE pd_kind = 'array') AS pd_array_denom,
  (SELECT COUNT(*) FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet') WHERE rp_kind = 'valid') AS rp_valid_denom;
