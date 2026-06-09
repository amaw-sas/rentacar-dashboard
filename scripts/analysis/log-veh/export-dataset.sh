#!/usr/bin/env bash
# export-dataset.sh — export the materialized PII-free tables to a Parquet snapshot.
#
# After Phase 3 `materialize.sql` builds `search_flat` (664,126 rows) and `cat_quotes`
# (2,974,126 rows) in the throwaway MariaDB, this writes them to a compact, instantly
# DuckDB-queryable Parquet snapshot that outlives both the 6.8 GiB raw archive and the
# 20-minute MariaDB rebuild. The snapshot is the single interface to the report layer.
#
# Two export paths (same DECIMAL-faithful output):
#   PRIMARY  — DuckDB ATTACHes the MariaDB over its Unix socket (TYPE mysql, READ_ONLY)
#              and COPYs each table to Parquet. Needs the `mysql` DuckDB extension
#              (INSTALL fetches it over the network the first time).
#   FALLBACK — `mariadb --batch` dumps each table to a TSV, then DuckDB read_csv pins
#              delim='\t', nullstr='\N' (mariadb's NULL marker) and an EXPLICIT columns
#              map giving every amount column DECIMAL(16,2). The explicit DECIMAL is
#              REQUIRED: CSV inference would coerce amounts to DOUBLE and break exact
#              faithfulness. Without it the two paths would diverge.
#
# Post-export: an ALLOWLIST schema assertion — each Parquet's column-name set must equal
# EXACTLY its expected list (PII-free by construction). Any extra/missing column aborts
# the export non-zero. This catches accidental future column additions that carry signal,
# not just the two known PII names (source_ip / response_raw, which live nowhere here).
#
# PII discipline: this exports only `search_flat` (no source_ip column) and `cat_quotes`
# (no PII columns). `response_raw` is never touched. The Parquet is PII-free.
#
# Env / args (env wins; defaults shown):
#   SOCKET   default /tmp/log-veh-analysis-db/mysqld.sock
#   DB       default analysis
#   OUT_DIR  default <script_dir>/dataset   (gitignored)
#   DUCKDB   default duckdb on PATH (falls back to ~/.local/bin/duckdb)
#
# On success: prints the two Parquet paths + their row counts; exits 0.
set -Eeuo pipefail
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SOCKET="${SOCKET:-/tmp/log-veh-analysis-db/mysqld.sock}"
DB="${DB:-analysis}"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/dataset}"

# Resolve a DuckDB binary.
DUCKDB="${DUCKDB:-}"
if [[ -z "$DUCKDB" ]]; then
  if command -v duckdb >/dev/null 2>&1; then DUCKDB="duckdb"
  elif [[ -x "$HOME/.local/bin/duckdb" ]]; then DUCKDB="$HOME/.local/bin/duckdb"
  else DUCKDB="duckdb"; fi
fi

log() { printf '[export] %s\n' "$*" >&2; }
die() { printf '[export][ERROR] %s\n' "$*" >&2; exit 1; }

# --- Expected column allowlists (order-insensitive; compared as sorted sets) ----
SEARCH_FLAT_COLS="created_at,error_code,id,n_categories,pd_kind,pickup_dt,pickup_location,response_status,return_dt,return_location,rp_kind"
CAT_QUOTES_COLS="category_code,category_description,coverage_unit_charge,discount_amount,estimated_total_amount,extra_hours_total,iva_fee_amount,rate_qualifier,search_id,tax_fee_amount,total_amount"

# --- Preflight -----------------------------------------------------------------
[[ -S "$SOCKET" ]] || die "no MariaDB socket at $SOCKET — run provision-db.sh + materialize.sql first"
command -v "$DUCKDB" >/dev/null 2>&1 || [[ -x "$DUCKDB" ]] || die "duckdb not found: $DUCKDB"
command -v mariadb >/dev/null 2>&1 || die "mariadb client not found (needed for the fallback path)"
mkdir -p "$OUT_DIR"

SEARCH_PARQUET="$OUT_DIR/search_flat.parquet"
CAT_PARQUET="$OUT_DIR/cat_quotes.parquet"

# Confirm the materialized tables exist before attempting either path.
for t in search_flat cat_quotes; do
  if ! mariadb --socket="$SOCKET" -N -B -e "SELECT 1 FROM \`$t\` LIMIT 1;" "$DB" >/dev/null 2>&1; then
    die "table \`$t\` not present/queryable in DB \`$DB\` — run materialize.sql first"
  fi
done

# --- PRIMARY path: DuckDB ATTACH over the socket -------------------------------
export_via_attach() {
  log "PRIMARY path: DuckDB ATTACH (TYPE mysql, READ_ONLY) over $SOCKET"
  "$DUCKDB" -c "
    INSTALL mysql;
    LOAD mysql;
    ATTACH 'host=localhost socket=$SOCKET user=root database=$DB' AS m (TYPE mysql, READ_ONLY);
    COPY (SELECT * FROM m.search_flat) TO '$SEARCH_PARQUET' (FORMAT parquet);
    COPY (SELECT * FROM m.cat_quotes)  TO '$CAT_PARQUET'   (FORMAT parquet);
  "
}

# --- FALLBACK path: mariadb --batch TSV -> DuckDB read_csv (DECIMAL-pinned) -----
export_via_tsv() {
  log "FALLBACK path: mariadb --batch TSV bridge -> DuckDB read_csv (DECIMAL-pinned)"
  local sf_tsv cq_tsv
  sf_tsv="$(mktemp /tmp/log-veh-export-search_flat.XXXXXX.tsv)"
  cq_tsv="$(mktemp /tmp/log-veh-export-cat_quotes.XXXXXX.tsv)"
  # mariadb --batch emits tab-separated, NULL as \N, no header with -N. Column order
  # is the SELECT order, which the read_csv columns map below mirrors exactly.
  mariadb --socket="$SOCKET" --batch -N -e "
    SELECT id, pickup_location, return_location, pickup_dt, return_dt,
           created_at, response_status, pd_kind, rp_kind, error_code, n_categories
    FROM search_flat" "$DB" > "$sf_tsv"
  mariadb --socket="$SOCKET" --batch -N -e "
    SELECT search_id, category_code, category_description, total_amount,
           estimated_total_amount, discount_amount, tax_fee_amount, iva_fee_amount,
           coverage_unit_charge, extra_hours_total, rate_qualifier
    FROM cat_quotes" "$DB" > "$cq_tsv"

  # mariadb --batch escapes TAB/newline/backslash as \t \n \\ ; DuckDB read_csv with
  # escape='' reads them literally. The macro `un()` reverses that on free-text columns so
  # the fallback stays byte-faithful to the attach path: sentinel-protect the real backslash
  # first, then decode \t and \n, then restore. Code/enum columns (location/category codes,
  # pd_kind/rp_kind, error_code) are machine-generated and cannot contain these chars, so
  # only cat_quotes' free-text columns (category_description, rate_qualifier) need decoding.
  "$DUCKDB" -c "
    CREATE OR REPLACE MACRO un(s) AS
      replace(replace(replace(replace(s, '\\\\', chr(1)), '\\t', chr(9)), '\\n', chr(10)), chr(1), '\\');
    COPY (
      SELECT * FROM read_csv('$sf_tsv',
        delim='\t', nullstr='\N', header=false, quote='', escape='',
        columns={
          'id': 'BIGINT',
          'pickup_location': 'VARCHAR',
          'return_location': 'VARCHAR',
          'pickup_dt': 'TIMESTAMP',
          'return_dt': 'TIMESTAMP',
          'created_at': 'TIMESTAMP',
          'response_status': 'INTEGER',
          'pd_kind': 'VARCHAR',
          'rp_kind': 'VARCHAR',
          'error_code': 'VARCHAR',
          'n_categories': 'INTEGER'
        })
    ) TO '$SEARCH_PARQUET' (FORMAT parquet);
    COPY (
      SELECT search_id, category_code, un(category_description) AS category_description,
        total_amount, estimated_total_amount, discount_amount, tax_fee_amount,
        iva_fee_amount, coverage_unit_charge, extra_hours_total,
        un(rate_qualifier) AS rate_qualifier
      FROM read_csv('$cq_tsv',
        delim='\t', nullstr='\N', header=false, quote='', escape='',
        columns={
          'search_id': 'BIGINT',
          'category_code': 'VARCHAR',
          'category_description': 'VARCHAR',
          'total_amount': 'DECIMAL(16,2)',
          'estimated_total_amount': 'DECIMAL(16,2)',
          'discount_amount': 'DECIMAL(16,2)',
          'tax_fee_amount': 'DECIMAL(16,2)',
          'iva_fee_amount': 'DECIMAL(16,2)',
          'coverage_unit_charge': 'DECIMAL(16,2)',
          'extra_hours_total': 'DECIMAL(16,2)',
          'rate_qualifier': 'VARCHAR'
        })
    ) TO '$CAT_PARQUET' (FORMAT parquet);
  "
  local rc=$?
  find "$sf_tsv" "$cq_tsv" -type f -delete 2>/dev/null || true
  return $rc
}

# --- Run PRIMARY, fall back on any failure -------------------------------------
PATH_TAKEN=""
ATTACH_ERR="$(mktemp /tmp/log-veh-export-attach.XXXXXX.err)"
if export_via_attach 2>"$ATTACH_ERR"; then
  PATH_TAKEN="attach"
  log "PRIMARY path succeeded"
else
  log "PRIMARY path failed (see below); trying FALLBACK"
  sed 's/^/[export][attach-stderr] /' "$ATTACH_ERR" >&2 || true
  if export_via_tsv; then
    PATH_TAKEN="tsv"
    log "FALLBACK path succeeded"
  else
    find "$ATTACH_ERR" -type f -delete 2>/dev/null || true
    die "BOTH export paths failed — no Parquet written (no partial export)"
  fi
fi
find "$ATTACH_ERR" -type f -delete 2>/dev/null || true

[[ -f "$SEARCH_PARQUET" ]] || die "expected $SEARCH_PARQUET not written"
[[ -f "$CAT_PARQUET" ]]    || die "expected $CAT_PARQUET not written"

# --- ALLOWLIST schema assertion ------------------------------------------------
# DESCRIBE returns one row per column; column_name is the first field. Sort the set and
# compare to the expected sorted CSV. Abort on any mismatch (extra OR missing column).
assert_schema() {
  local parquet="$1" expected="$2" label="$3"
  local actual
  actual="$("$DUCKDB" -noheader -list -c \
    "SELECT column_name FROM (DESCRIBE SELECT * FROM '$parquet') ORDER BY column_name;" \
    | grep -v '^[[:space:]]*$' | paste -sd, -)"
  if [[ "$actual" != "$expected" ]]; then
    printf '[export][ERROR] %s schema mismatch:\n' "$label" >&2
    printf '  expected: %s\n' "$expected" >&2
    printf '  actual:   %s\n' "$actual" >&2
    die "allowlist schema assertion FAILED for $label — aborting (PII-free guarantee broken)"
  fi
  log "$label schema OK (allowlist: $expected)"
}

assert_schema "$SEARCH_PARQUET" "$SEARCH_FLAT_COLS" "search_flat.parquet"
assert_schema "$CAT_PARQUET"    "$CAT_QUOTES_COLS"  "cat_quotes.parquet"

# --- Row counts ----------------------------------------------------------------
sf_n="$("$DUCKDB" -noheader -list -c "SELECT COUNT(*) FROM '$SEARCH_PARQUET';")"
cq_n="$("$DUCKDB" -noheader -list -c "SELECT COUNT(*) FROM '$CAT_PARQUET';")"

log "export complete via $PATH_TAKEN path"
log "search_flat.parquet rows: $sf_n  ($SEARCH_PARQUET)"
log "cat_quotes.parquet rows:  $cq_n  ($CAT_PARQUET)"

# stdout: machine-friendly summary (path + counts + files).
printf 'path_taken=%s\nsearch_flat_rows=%s\ncat_quotes_rows=%s\nsearch_flat_parquet=%s\ncat_quotes_parquet=%s\n' \
  "$PATH_TAKEN" "$sf_n" "$cq_n" "$SEARCH_PARQUET" "$CAT_PARQUET"
