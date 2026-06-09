-- 02-pricing-by-category-season.sql — DuckDB over the Parquet snapshot.
--
-- Report 02: the price corpus. Per category_code price distribution (median/avg/p25/p75/
-- min/max + n_quotes), plus per category x month. This is the ONLY clean historical corpus
-- of quoted prices (public.search_logs stores no prices).
--
-- Carved out of the "totals reconcile" check: quantiles/medians do NOT sum. It is validated
-- instead by its input row count — the sum of n_quotes across categories equals 2,974,126
-- (cat_quotes rows) — and by the SCEN-002 faithfulness anchor (top category G4 = 434,746).
--
-- Reads ONLY cat_quotes.parquet (PII-free, no PII columns). DECIMAL(16,2) amounts are
-- preserved by the export (NOT coerced to DOUBLE), so medians/percentiles are exact.
-- Deterministic: explicit ORDER BY with a stable tie-break.
SET VARIABLE dataset_dir = coalesce(
  getvariable('dataset_dir'),
  'scripts/analysis/log-veh/dataset'
);

SELECT '=== REPORT 02: pricing by category + season ===' AS section;

-- 02a — price distribution per category. n_quotes is the full per-category count
-- (sums to 2,974,126); price stats use only non-null total_amount quotes.
-- quantile_cont gives the continuous (interpolated) median/percentiles.
SELECT '--- 02a: total_amount distribution per category (n_quotes sums to 2,974,126) ---' AS subsection;
SELECT
  category_code,
  MIN(category_description)                                   AS category_description,
  COUNT(*)                                                    AS n_quotes,
  COUNT(total_amount)                                         AS n_priced_quotes,
  CAST(quantile_cont(total_amount, 0.25) AS DECIMAL(16,2))   AS p25_total_amount,
  CAST(quantile_cont(total_amount, 0.50) AS DECIMAL(16,2))   AS median_total_amount,
  CAST(quantile_cont(total_amount, 0.75) AS DECIMAL(16,2))   AS p75_total_amount,
  CAST(AVG(total_amount) AS DECIMAL(16,2))                   AS avg_total_amount,
  CAST(MIN(total_amount) AS DECIMAL(16,2))                   AS min_total_amount,
  CAST(MAX(total_amount) AS DECIMAL(16,2))                   AS max_total_amount
FROM read_parquet(getvariable('dataset_dir') || '/cat_quotes.parquet')
GROUP BY category_code
ORDER BY n_quotes DESC, category_code ASC;

-- 02b — median + avg total_amount per category x month (seasonality of price).
-- created_at is not on cat_quotes, so join back to search_flat by search_id for the month.
SELECT '--- 02b: median + avg total_amount per category x month ---' AS subsection;
SELECT
  cq.category_code,
  strftime(sf.created_at, '%Y-%m')                           AS month_utc,
  COUNT(*)                                                    AS n_quotes,
  CAST(quantile_cont(cq.total_amount, 0.50) AS DECIMAL(16,2)) AS median_total_amount,
  CAST(AVG(cq.total_amount) AS DECIMAL(16,2))                AS avg_total_amount
FROM read_parquet(getvariable('dataset_dir') || '/cat_quotes.parquet') cq
JOIN read_parquet(getvariable('dataset_dir') || '/search_flat.parquet') sf
  ON sf.id = cq.search_id
GROUP BY cq.category_code, month_utc
ORDER BY cq.category_code ASC, month_utc ASC;

-- 02c — reconciliation anchor: total cat_quotes rows (must equal 2,974,126 on the full snapshot).
SELECT '--- 02c: reconciliation (sum of n_quotes = cat_quotes rows) ---' AS subsection;
SELECT COUNT(*) AS total_quotes
FROM read_parquet(getvariable('dataset_dir') || '/cat_quotes.parquet');
