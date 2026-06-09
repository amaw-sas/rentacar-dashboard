-- materialize.sql — build the two helper tables for the log_veh Phase 3 analysis.
--
-- Run as:  mariadb --socket=$SOCKET analysis < materialize.sql
--
-- PII discipline: this file NEVER reads `response_raw`. It does NOT read `source_ip`
-- values either (source_ip appears nowhere here). Only the PII-free columns
-- (request_parameters scalars, processed_data classification) are materialized.
--
-- search_flat : one row per source row (exactly the loaded COUNT(*)). Classifies every
--               row into pd_kind/rp_kind so nothing is dropped silently.
-- cat_quotes  : processed_data arrays exploded via JSON_TABLE, over pd_kind='array' only.

SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';
SET time_zone = '+00:00';  -- source dump is UTC; keep UTC end-to-end.

DROP TABLE IF EXISTS search_flat;
DROP TABLE IF EXISTS cat_quotes;

-- ---------------------------------------------------------------------------
-- search_flat : one row per search
-- ---------------------------------------------------------------------------
CREATE TABLE search_flat (
  id              BIGINT       NOT NULL PRIMARY KEY,
  pickup_location VARCHAR(16)  NULL,
  return_location VARCHAR(16)  NULL,
  pickup_dt       DATETIME     NULL,
  return_dt       DATETIME     NULL,
  created_at      TIMESTAMP    NULL,
  response_status INT          NOT NULL,
  pd_kind         VARCHAR(16)  NOT NULL,   -- array | error | malformed | null
  rp_kind         VARCHAR(16)  NOT NULL,   -- valid | malformed | null
  error_code      VARCHAR(64)  NULL,
  n_categories    INT          NOT NULL DEFAULT 0,
  KEY idx_pd_kind (pd_kind),
  KEY idx_rp_kind (rp_kind),
  KEY idx_created (created_at)
) ENGINE=InnoDB;

INSERT INTO search_flat (
  id, pickup_location, return_location, pickup_dt, return_dt,
  created_at, response_status, pd_kind, rp_kind, error_code, n_categories
)
SELECT
  s.id,
  -- request_parameters scalars (NULL when rp_kind != 'valid' is acceptable)
  JSON_VALUE(s.request_parameters, '$.pickupLocation')  AS pickup_location,
  JSON_VALUE(s.request_parameters, '$.returnLocation')  AS return_location,
  STR_TO_DATE(JSON_VALUE(s.request_parameters, '$.pickupDateTime'), '%Y-%m-%dT%H:%i:%s') AS pickup_dt,
  STR_TO_DATE(JSON_VALUE(s.request_parameters, '$.returnDateTime'), '%Y-%m-%dT%H:%i:%s') AS return_dt,
  s.created_at,
  s.response_status,
  -- pd_kind classification (JSON_TYPE guarded behind JSON_VALID).
  -- NOTE: the source schema declares both JSON columns `CHECK (json_valid(...))`, so the
  -- 'malformed' branch is unreachable against THIS table (it always counts 0 — confirmed
  -- in the run). It is kept deliberately: it is load-bearing if these queries are reused
  -- against an unconstrained table, and it makes "nothing is dropped silently" total by
  -- construction rather than by trusting the source constraint.
  CASE
    WHEN s.processed_data IS NULL THEN 'null'
    WHEN NOT JSON_VALID(s.processed_data) THEN 'malformed'
    WHEN JSON_TYPE(s.processed_data) = 'ARRAY' THEN 'array'
    WHEN JSON_EXTRACT(s.processed_data, '$.error') IS NOT NULL THEN 'error'
    ELSE 'malformed'
  END AS pd_kind,
  -- rp_kind classification
  CASE
    WHEN s.request_parameters IS NULL THEN 'null'
    WHEN NOT JSON_VALID(s.request_parameters) THEN 'malformed'
    WHEN JSON_EXTRACT(s.request_parameters, '$.pickupLocation') IS NOT NULL
     AND JSON_EXTRACT(s.request_parameters, '$.returnLocation') IS NOT NULL
     AND JSON_EXTRACT(s.request_parameters, '$.pickupDateTime') IS NOT NULL
     AND JSON_EXTRACT(s.request_parameters, '$.returnDateTime') IS NOT NULL
      THEN 'valid'
    ELSE 'malformed'
  END AS rp_kind,
  -- error_code only when pd_kind='error'
  CASE
    WHEN s.processed_data IS NOT NULL
     AND JSON_VALID(s.processed_data)
     AND JSON_TYPE(s.processed_data) <> 'ARRAY'
     AND JSON_EXTRACT(s.processed_data, '$.error') IS NOT NULL
      THEN JSON_VALUE(s.processed_data, '$.error')
    ELSE NULL
  END AS error_code,
  -- n_categories only when pd_kind='array'
  CASE
    WHEN s.processed_data IS NOT NULL
     AND JSON_VALID(s.processed_data)
     AND JSON_TYPE(s.processed_data) = 'ARRAY'
      THEN JSON_LENGTH(s.processed_data)
    ELSE 0
  END AS n_categories
FROM log_veh_available_rates_queries s;

-- ---------------------------------------------------------------------------
-- cat_quotes : exploded category quotes (pd_kind='array' only)
-- ---------------------------------------------------------------------------
CREATE TABLE cat_quotes (
  search_id              BIGINT       NOT NULL,
  category_code          VARCHAR(16)  NULL,
  category_description   VARCHAR(255) NULL,
  total_amount           DECIMAL(16,2) NULL,
  estimated_total_amount DECIMAL(16,2) NULL,
  discount_amount        DECIMAL(16,2) NULL,
  tax_fee_amount         DECIMAL(16,2) NULL,
  iva_fee_amount         DECIMAL(16,2) NULL,
  coverage_unit_charge   DECIMAL(16,2) NULL,
  extra_hours_total      DECIMAL(16,2) NULL,
  rate_qualifier         VARCHAR(64)  NULL,
  KEY idx_search (search_id),
  KEY idx_catcode (category_code)
) ENGINE=InnoDB;

INSERT INTO cat_quotes (
  search_id, category_code, category_description, total_amount,
  estimated_total_amount, discount_amount, tax_fee_amount, iva_fee_amount,
  coverage_unit_charge, extra_hours_total, rate_qualifier
)
SELECT
  sf.id,
  jt.category_code,
  jt.category_description,
  jt.total_amount,
  jt.estimated_total_amount,
  jt.discount_amount,
  jt.tax_fee_amount,
  jt.iva_fee_amount,
  jt.coverage_unit_charge,
  jt.extra_hours_total,
  jt.rate_qualifier
FROM search_flat sf
JOIN log_veh_available_rates_queries s ON s.id = sf.id,
JSON_TABLE(s.processed_data, '$[*]' COLUMNS (
  category_code          VARCHAR(16)   PATH '$.categoryCode',
  category_description   VARCHAR(255)  PATH '$.categoryDescription',
  total_amount           DECIMAL(16,2) PATH '$.totalAmount',
  estimated_total_amount DECIMAL(16,2) PATH '$.estimatedTotalAmount',
  discount_amount        DECIMAL(16,2) PATH '$.discountAmount',
  tax_fee_amount         DECIMAL(16,2) PATH '$.taxFeeAmount',
  iva_fee_amount         DECIMAL(16,2) PATH '$.IVAFeeAmount',
  coverage_unit_charge   DECIMAL(16,2) PATH '$.coverageUnitCharge',
  extra_hours_total      DECIMAL(16,2) PATH '$.extraHoursTotalAmount',
  rate_qualifier         VARCHAR(64)   PATH '$.rateQualifier'
)) jt
WHERE sf.pd_kind = 'array';

-- Materialization summary (PII-free counts, useful as a load sanity check).
SELECT 'search_flat rows'    AS metric, COUNT(*) AS value FROM search_flat
UNION ALL
SELECT 'cat_quotes rows'     AS metric, COUNT(*) AS value FROM cat_quotes;
