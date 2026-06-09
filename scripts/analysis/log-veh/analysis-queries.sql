-- analysis-queries.sql — the 11 PII-free cuts for log_veh Phase 3.
--
-- Run as:  mariadb --socket=$SOCKET analysis < analysis-queries.sql
--
-- PII discipline (hard limit):
--   * `response_raw` is referenced NOWHERE in this file (never read).
--   * `source_ip` appears ONLY inside COUNT(DISTINCT source_ip) — its values never
--     reach output.
-- Determinism: every ordered cut has a deterministic ORDER BY with a stable tie-break
--   key, so two consecutive runs are byte-identical (SCEN-004).
-- Denominators: each cut states its denominator inline; reconcile totals to:
--   all-rows (664,126) for #1,#4,#8,#10; rp_kind='valid' for #6,#7,#9;
--   pd_kind='array' for #5,#11.
-- Timezone: UTC end-to-end (source dump header SET TIME_ZONE='+00:00').

SET time_zone = '+00:00';

-- ===========================================================================
SELECT '=== CUT 1: volume + temporal range (denominator: all rows) ===' AS section;
-- Total volume, created_at MIN/MAX, span in days, avg rows/day.
-- distinct_source_ips reads source_ip ONLY as COUNT(DISTINCT ...) and ONLY from the base
-- table (search_flat deliberately excludes PII columns); its values never reach output.
SELECT
  COUNT(*)                                                        AS total_rows,
  MIN(created_at)                                                 AS first_search_utc,
  MAX(created_at)                                                 AS last_search_utc,
  DATEDIFF(MAX(created_at), MIN(created_at)) + 1                  AS span_days,
  ROUND(COUNT(*) / (DATEDIFF(MAX(created_at), MIN(created_at)) + 1), 1) AS avg_rows_per_day,
  (SELECT COUNT(DISTINCT source_ip) FROM log_veh_available_rates_queries) AS distinct_source_ips
FROM search_flat;

-- ===========================================================================
SELECT '=== CUT 2: location distribution (denominator: rp_kind=valid) ===' AS section;
-- Top pickup locations.
SELECT 'pickup' AS leg, pickup_location AS location, COUNT(*) AS searches
FROM search_flat
WHERE rp_kind = 'valid'
GROUP BY pickup_location
ORDER BY searches DESC, location ASC
LIMIT 25;
-- Top return locations.
SELECT 'return' AS leg, return_location AS location, COUNT(*) AS searches
FROM search_flat
WHERE rp_kind = 'valid'
GROUP BY return_location
ORDER BY searches DESC, location ASC
LIMIT 25;
-- NULL/empty location rate (over rp_kind=valid denominator).
SELECT
  SUM(pickup_location IS NULL OR pickup_location = '') AS pickup_null_or_empty,
  SUM(return_location IS NULL OR return_location = '') AS return_null_or_empty,
  COUNT(*)                                             AS denom_rp_valid
FROM search_flat
WHERE rp_kind = 'valid';

-- ===========================================================================
SELECT '=== CUT 3: date distribution (searches per month + pickup-date) ===' AS section;
-- Searches per calendar month of created_at (denominator: all rows).
SELECT DATE_FORMAT(created_at, '%Y-%m') AS month_utc, COUNT(*) AS searches
FROM search_flat
GROUP BY month_utc
ORDER BY month_utc ASC;
-- Requested pickup-date distribution per month (denominator: rp_kind=valid w/ parseable pickup_dt).
SELECT DATE_FORMAT(pickup_dt, '%Y-%m') AS pickup_month, COUNT(*) AS searches
FROM search_flat
WHERE rp_kind = 'valid' AND pickup_dt IS NOT NULL
GROUP BY pickup_month
ORDER BY pickup_month ASC;

-- ===========================================================================
SELECT '=== CUT 4: pd_kind share + error breakdown (denominator: all rows) ===' AS section;
-- processed_data classification share over all rows. Sums to 664,126.
SELECT
  pd_kind,
  COUNT(*)                                  AS rows_n,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM search_flat
GROUP BY pd_kind
ORDER BY rows_n DESC, pd_kind ASC;
-- Breakdown by error_code (denominator: pd_kind='error' count).
SELECT
  error_code,
  COUNT(*)                                  AS rows_n,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct_of_errors
FROM search_flat
WHERE pd_kind = 'error'
GROUP BY error_code
ORDER BY rows_n DESC, error_code ASC;

-- ===========================================================================
SELECT '=== CUT 5: top categories by frequency + availability rate (denominator: pd_kind=array) ===' AS section;
-- For each category: how many array-kind searches returned it (search frequency),
-- and that over the count of array-kind searches (availability rate).
SELECT
  cq.category_code,
  MIN(cq.category_description)                              AS category_description,
  COUNT(DISTINCT cq.search_id)                              AS searches_with_category,
  ROUND(
    100 * COUNT(DISTINCT cq.search_id)
    / (SELECT COUNT(*) FROM search_flat WHERE pd_kind = 'array'),
    3
  )                                                         AS availability_rate_pct
FROM cat_quotes cq
GROUP BY cq.category_code
ORDER BY searches_with_category DESC, cq.category_code ASC;

-- ===========================================================================
SELECT '=== CUT 6: lead time pickup_dt - created_at, bucketed (denominator: rp_kind=valid) ===' AS section;
-- TIMESTAMPDIFF in hours; bucketed. Only rows with both timestamps parseable contribute;
-- the "unparseable_or_null" bucket keeps the cut summing to the rp_kind=valid denominator.
SELECT bucket, COUNT(*) AS searches
FROM (
  SELECT CASE
    WHEN pickup_dt IS NULL OR created_at IS NULL THEN 'z_unparseable_or_null'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 0    THEN '00_negative'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 24   THEN '01_lt_1d'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 72   THEN '02_1_3d'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 168  THEN '03_3_7d'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 720  THEN '04_7_30d'
    WHEN TIMESTAMPDIFF(HOUR, created_at, pickup_dt) < 2160 THEN '05_30_90d'
    ELSE '06_gt_90d'
  END AS bucket
  FROM search_flat
  WHERE rp_kind = 'valid'
) t
GROUP BY bucket
ORDER BY bucket ASC;

-- ===========================================================================
SELECT '=== CUT 7: rental duration return_dt - pickup_dt, bucketed (denominator: rp_kind=valid) ===' AS section;
SELECT bucket, COUNT(*) AS searches
FROM (
  SELECT CASE
    WHEN pickup_dt IS NULL OR return_dt IS NULL THEN 'z_unparseable_or_null'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) <= 0   THEN '00_non_positive'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) < 24   THEN '01_lt_1d'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) < 72   THEN '02_1_3d'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) < 168  THEN '03_3_7d'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) < 336  THEN '04_7_14d'
    WHEN TIMESTAMPDIFF(HOUR, pickup_dt, return_dt) < 720  THEN '05_14_30d'
    ELSE '06_gt_30d'
  END AS bucket
  FROM search_flat
  WHERE rp_kind = 'valid'
) t
GROUP BY bucket
ORDER BY bucket ASC;

-- ===========================================================================
SELECT '=== CUT 8: hour-of-day + day-of-week of created_at (denominator: all rows) ===' AS section;
-- Hour-of-day (0..23 UTC). Sums to 664,126.
SELECT HOUR(created_at) AS hour_utc, COUNT(*) AS searches
FROM search_flat
GROUP BY hour_utc
ORDER BY hour_utc ASC;
-- Day-of-week (1=Sunday..7=Saturday per DAYOFWEEK). Sums to 664,126.
SELECT DAYOFWEEK(created_at) AS dow_1sun, DAYNAME(created_at) AS dow_name, COUNT(*) AS searches
FROM search_flat
GROUP BY dow_1sun, dow_name
ORDER BY dow_1sun ASC;

-- ===========================================================================
SELECT '=== CUT 9: one-way vs round-trip (denominator: rp_kind=valid) ===' AS section;
SELECT
  CASE WHEN pickup_location <=> return_location THEN 'round_trip' ELSE 'one_way' END AS trip_type,
  COUNT(*)                                        AS searches,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM search_flat
WHERE rp_kind = 'valid'
GROUP BY trip_type
ORDER BY searches DESC, trip_type ASC;

-- ===========================================================================
SELECT '=== CUT 10: response_status distribution (denominator: all rows) ===' AS section;
-- Sums to 664,126.
SELECT
  response_status,
  COUNT(*)                                        AS rows_n,
  ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM search_flat
GROUP BY response_status
ORDER BY rows_n DESC, response_status ASC;

-- ===========================================================================
SELECT '=== CUT 11: avg/median total_amount per category (denominator: cat_quotes rows) ===' AS section;
-- Median via PERCENTILE_CONT(0.5) window (MariaDB 10.11 has no MEDIAN aggregate;
-- PERCENTILE_CONT is the supported equivalent). Only quotes with a non-null
-- total_amount contribute to the price stats; n_quotes is the full per-category count.
SELECT
  category_code,
  MIN(category_description)                       AS category_description,
  COUNT(*)                                        AS n_quotes,
  SUM(total_amount IS NOT NULL)                   AS n_priced_quotes,
  ROUND(AVG(total_amount), 2)                     AS avg_total_amount,
  ROUND(MIN(total_amount), 2)                     AS min_total_amount,
  ROUND(MAX(total_amount), 2)                     AS max_total_amount,
  ROUND(MAX(median_total_amount), 2)              AS median_total_amount
FROM (
  SELECT
    category_code,
    category_description,
    total_amount,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_amount) OVER (PARTITION BY category_code) AS median_total_amount
  FROM cat_quotes
) q
GROUP BY category_code
ORDER BY n_quotes DESC, category_code ASC;
