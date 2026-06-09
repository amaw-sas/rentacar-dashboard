-- query-examples.sql — copy-paste DuckDB snippets for ad-hoc querying of the Parquet snapshot.
--
-- The snapshot lives (gitignored) at scripts/analysis/log-veh/dataset/. Once it exists you
-- need NO MariaDB and NO 6.8 GiB archive — DuckDB reads the Parquet directly.
--
-- Open an interactive shell from the repo root:
--   duckdb
-- then paste any snippet below. Or run a one-off:
--   duckdb -c "SELECT COUNT(*) FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet';"
--
-- The report SQL (reports/*.sql) uses a `dataset_dir` variable; these examples hard-code the
-- in-repo default path for copy-paste convenience. Adjust the path if your snapshot is elsewhere.

-- Row counts (faithfulness anchor: 664,126 / 2,974,126 on the full snapshot).
SELECT
  (SELECT COUNT(*) FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet') AS search_flat_rows,
  (SELECT COUNT(*) FROM 'scripts/analysis/log-veh/dataset/cat_quotes.parquet')  AS cat_quotes_rows;

-- SCEN-002 faithfulness anchors: array-kind searches (479,402) + top category (G4 = 434,746).
SELECT COUNT(*) AS pd_array
FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet'
WHERE pd_kind = 'array';

SELECT category_code, COUNT(DISTINCT search_id) AS searches_with_category
FROM 'scripts/analysis/log-veh/dataset/cat_quotes.parquet'
GROUP BY category_code
ORDER BY searches_with_category DESC, category_code ASC
LIMIT 5;

-- Top pickup branches by search volume.
SELECT pickup_location, COUNT(*) AS searches
FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet'
GROUP BY pickup_location
ORDER BY searches DESC, pickup_location ASC
LIMIT 10;

-- Monthly demand (UTC) over the whole history.
SELECT strftime(created_at, '%Y-%m') AS month_utc, COUNT(*) AS searches
FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet'
GROUP BY month_utc
ORDER BY month_utc ASC;

-- Median + p25/p75 quoted total_amount for the top category G4.
SELECT
  category_code,
  COUNT(*)                                    AS n_quotes,
  ROUND(quantile_cont(total_amount, 0.25), 2) AS p25,
  ROUND(quantile_cont(total_amount, 0.50), 2) AS median,
  ROUND(quantile_cont(total_amount, 0.75), 2) AS p75
FROM 'scripts/analysis/log-veh/dataset/cat_quotes.parquet'
WHERE category_code = 'G4'
GROUP BY category_code;

-- Quote failure share (pd_kind) over all rows.
SELECT pd_kind, COUNT(*) AS rows_n,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct
FROM 'scripts/analysis/log-veh/dataset/search_flat.parquet'
GROUP BY pd_kind
ORDER BY rows_n DESC, pd_kind ASC;

-- Join example: median price per category for searches at a given pickup branch.
-- (Replace 'BOG' with any branch code present in 01a output.)
SELECT cq.category_code,
  COUNT(*)                                    AS n_quotes,
  ROUND(quantile_cont(cq.total_amount, 0.5), 2) AS median_total_amount
FROM 'scripts/analysis/log-veh/dataset/cat_quotes.parquet' cq
JOIN 'scripts/analysis/log-veh/dataset/search_flat.parquet' sf
  ON sf.id = cq.search_id
WHERE sf.pickup_location = 'BOG'
GROUP BY cq.category_code
ORDER BY n_quotes DESC, cq.category_code ASC
LIMIT 10;
