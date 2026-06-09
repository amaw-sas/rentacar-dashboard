-- 01-demand-by-branch-month.sql — DuckDB over the Parquet snapshot.
--
-- Report 01: demand by pickup branch, by month, and top pickup->return routes.
-- Denominator: all rows = 664,126 (rp_kind='valid' also = 664,126, since every row has
-- all four request_parameters fields — see spec §6). The per-branch and per-month cuts
-- therefore both reconcile to 664,126.
--
-- Reads ONLY search_flat.parquet (PII-free). Deterministic: every ORDER BY has a stable
-- tie-break, so two runs are byte-identical (SCEN-007).
--
-- Path resolution: `dataset_dir` is set by generate-reports.sh (-c "SET VARIABLE ...").
-- Standalone, it self-defaults to the in-repo gitignored snapshot dir below.
SET VARIABLE dataset_dir = coalesce(
  getvariable('dataset_dir'),
  'scripts/analysis/log-veh/dataset'
);

SELECT '=== REPORT 01: demand by branch + month + routes ===' AS section;

-- 01a — searches per pickup branch (top 25). Denominator: all rows (664,126).
SELECT '--- 01a: top pickup branches (denominator: all rows = 664,126) ---' AS subsection;
SELECT
  coalesce(pickup_location, '(null)')                        AS pickup_location,
  COUNT(*)                                                   AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3)         AS pct_of_all
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
GROUP BY pickup_location
ORDER BY searches DESC, pickup_location ASC
LIMIT 25;

-- 01b — searches per calendar month of created_at (UTC). Sums to all rows (664,126).
SELECT '--- 01b: searches per month of created_at, UTC (denominator: all rows = 664,126) ---' AS subsection;
SELECT
  strftime(created_at, '%Y-%m')                             AS month_utc,
  COUNT(*)                                                  AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3)        AS pct_of_all
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
GROUP BY month_utc
ORDER BY month_utc ASC;

-- 01c — top pickup -> return route pairs (top 25). Denominator: all rows (664,126).
SELECT '--- 01c: top pickup->return routes (top 25, denominator: all rows = 664,126) ---' AS subsection;
SELECT
  coalesce(pickup_location, '(null)')                       AS pickup_location,
  coalesce(return_location, '(null)')                       AS return_location,
  COUNT(*)                                                  AS searches,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3)        AS pct_of_all
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet')
GROUP BY pickup_location, return_location
ORDER BY searches DESC, pickup_location ASC, return_location ASC
LIMIT 25;

-- 01d — reconciliation anchor: total rows (must equal 664,126 on the full snapshot).
SELECT '--- 01d: reconciliation (total = denominator) ---' AS subsection;
SELECT COUNT(*) AS total_rows
FROM read_parquet(getvariable('dataset_dir') || '/search_flat.parquet');
