-- 03-quote-failure-rate.sql — DuckDB over the Parquet snapshot.
--
-- Report 03: quote failure analysis. processed_data classification share over all rows;
-- error_code breakdown; error rate by pickup branch x month.
--
-- Denominators:
--   * pd_kind share: all rows = 664,126 (the four pd_kind values sum to it).
--   * error_code breakdown: the error subset = 184,724 (the breakdown sums to it).
--
-- Reads ONLY search_flat.parquet (PII-free). NULLIF guards every percentage division so a
-- zero denominator yields NULL, not an error. Deterministic ORDER BY with stable tie-break.
SET VARIABLE dataset_dir = coalesce(
  getvariable('dataset_dir'),
  'scripts/analysis/log-veh/dataset'
);

SELECT '=== REPORT 03: quote failure rate ===' AS section;

-- 03a — pd_kind share over all rows (array vs error vs null vs malformed). Sums to 664,126.
SELECT '--- 03a: pd_kind share (denominator: all rows = 664,126) ---' AS subsection;
SELECT
  pd_kind,
  COUNT(*)                                                   AS rows_n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3)         AS pct_of_all
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
GROUP BY pd_kind
ORDER BY rows_n DESC, pd_kind ASC;

-- 03b — error_code breakdown over the error subset (pd_kind='error'). Sums to 184,724.
SELECT '--- 03b: error_code breakdown (denominator: pd_kind=error subset = 184,724) ---' AS subsection;
SELECT
  coalesce(error_code, '(null)')                            AS error_code,
  COUNT(*)                                                  AS rows_n,
  ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 3) AS pct_of_errors
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
WHERE pd_kind = 'error'
GROUP BY error_code
ORDER BY rows_n DESC, error_code ASC;

-- 03c — error rate by pickup branch x month (top 30 by error volume).
-- error rate = error searches / all searches in that branch-month (NULLIF-guarded).
SELECT '--- 03c: error rate by pickup branch x month (top 30 by error volume) ---' AS subsection;
SELECT
  coalesce(pickup_location, '(null)')                       AS pickup_location,
  strftime(created_at, '%Y-%m')                             AS month_utc,
  COUNT(*)                                                  AS searches,
  SUM(CASE WHEN pd_kind = 'error' THEN 1 ELSE 0 END)        AS error_searches,
  ROUND(
    100.0 * SUM(CASE WHEN pd_kind = 'error' THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 3
  )                                                          AS error_rate_pct
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
GROUP BY pickup_location, month_utc
ORDER BY error_searches DESC, pickup_location ASC, month_utc ASC
LIMIT 30;

-- 03d — reconciliation anchor: the error subset count (must equal 184,724 on the full snapshot).
SELECT '--- 03d: reconciliation (error subset size) ---' AS subsection;
SELECT COUNT(*) AS error_subset_rows
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
WHERE pd_kind = 'error';
