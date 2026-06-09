#!/usr/bin/env bash
# Load the Phase 2 log_veh archive into the throwaway MariaDB, then reconcile.
#
# DDL footgun: EVERY chunk (not just chunk 1) begins with DROP TABLE + CREATE TABLE.
# A naive sequential load would have each chunk wipe the prior chunk's rows. So:
#   - chunk 1 loads IN FULL (its DROP+CREATE builds the table + 25000 rows),
#   - chunks 2..N load INSERT-ONLY by piping  zcat | grep '^INSERT INTO' | mariadb
#     (append; never re-runs the DROP).
# --skip-extended-insert in the dump => exactly one INSERT INTO per data row, so the
# grep extracts precisely the data rows.
#
# Reconcile: SELECT COUNT(*) must equal the expected total (manifest total_rows by
# default; override EXPECTED_ROWS for a partial/smoke load). On mismatch: abort, no
# analysis.
#
# Env / args (env wins; defaults shown):
#   ARCHIVE_DIR  default: the Phase 2 worktree archive path
#   SOCKET       default /tmp/log-veh-analysis-db/mysqld.sock
#   DB           default analysis
#   MAX_CHUNKS   default: all chunks present (load only the first N when set — smoke test)
#   EXPECTED_ROWS default: manifest total_rows (override for partial loads)
set -Eeuo pipefail
set -o pipefail

ARCHIVE_DIR="${ARCHIVE_DIR:-/home/pabloandi/proyectos/amaw/rentacar/rentacar-dashboard/.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended}"
SOCKET="${SOCKET:-/tmp/log-veh-analysis-db/mysqld.sock}"
DB="${DB:-analysis}"

log() { printf '[load] %s\n' "$*" >&2; }
die() { printf '[load][ERROR] %s\n' "$*" >&2; exit 1; }

[[ -S "$SOCKET" ]] || die "no MariaDB socket at $SOCKET — run provision-db.sh first"
[[ -d "$ARCHIVE_DIR" ]] || die "archive dir not found: $ARCHIVE_DIR"
[[ -f "$ARCHIVE_DIR/manifest.json" ]] || die "manifest.json not found in $ARCHIVE_DIR"

mysql() { mariadb --socket="$SOCKET" "$@"; }

# --- Discover chunks in PK order ------------------------------------------
mapfile -t CHUNKS < <(find "$ARCHIVE_DIR" -maxdepth 1 -name 'chunk-*.sql.gz' -printf '%f\n' | sort)
(( ${#CHUNKS[@]} > 0 )) || die "no chunk-*.sql.gz files in $ARCHIVE_DIR"

# Optionally cap the number of chunks (smoke test loads just chunk 1).
if [[ -n "${MAX_CHUNKS:-}" ]]; then
  CHUNKS=("${CHUNKS[@]:0:${MAX_CHUNKS}}")
  log "MAX_CHUNKS=${MAX_CHUNKS} — loading ${#CHUNKS[@]} chunk(s) only"
fi
log "found ${#CHUNKS[@]} chunk(s) to load"

# --- Expected reconcile target --------------------------------------------
if [[ -n "${EXPECTED_ROWS:-}" ]]; then
  EXPECTED="$EXPECTED_ROWS"
elif [[ -n "${MAX_CHUNKS:-}" ]]; then
  # Partial load: sum the manifest 'rows' of the chunks we actually load.
  EXPECTED="$(python3 -c "import json,sys; m=json.load(open('$ARCHIVE_DIR/manifest.json')); print(sum(c['rows'] for c in m['chunks'][:${#CHUNKS[@]}]))")"
else
  EXPECTED="$(python3 -c "import json; print(json.load(open('$ARCHIVE_DIR/manifest.json'))['total_rows'])")"
fi
log "reconcile target (expected rows): $EXPECTED"

# --- Create DB ------------------------------------------------------------
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# --- Load chunk 1 in full (DROP + CREATE + rows) --------------------------
first="${CHUNKS[0]}"
log "chunk 1/${#CHUNKS[@]} (full, builds table): $first"
zcat "$ARCHIVE_DIR/$first" | mysql "$DB"
log "chunk 1 loaded"

# --- Load chunks 2..N INSERT-only (append; no DROP) -----------------------
# Perf: wrap each chunk's ~25k single-row INSERTs in ONE transaction
# (autocommit=0 … COMMIT) so the load does 1 fsync/chunk instead of 1/row —
# without this, ~639k autocommitted INSERTs make the load orders slower.
for i in "${!CHUNKS[@]}"; do
  (( i == 0 )) && continue
  c="${CHUNKS[$i]}"
  log "chunk $((i+1))/${#CHUNKS[@]} (INSERT-only): $c"
  # pipefail is on inside the subshell too: `zcat | grep` failing (corrupt gz, OR
  # grep exit 1 = no INSERT lines, which every data chunk must have) trips `|| exit 1`,
  # making the brace-subshell non-zero; pipefail then fails the `… | mysql` pipe.
  if ! { echo 'SET autocommit=0; SET unique_checks=0;'
         zcat "$ARCHIVE_DIR/$c" | grep '^INSERT INTO' || exit 1
         echo 'COMMIT;'
       } | mysql "$DB"; then
    die "chunk $c failed to load"
  fi
done
log "all chunks loaded"

# --- Reconcile ------------------------------------------------------------
actual="$(mysql -N -B -e "SELECT COUNT(*) FROM \`log_veh_available_rates_queries\`;" "$DB")"
log "reconcile: expected=$EXPECTED actual=$actual"
if [[ "$actual" != "$EXPECTED" ]]; then
  die "RECONCILE MISMATCH: expected $EXPECTED rows, loaded $actual — aborting, no analysis."
fi
log "reconcile OK — $actual rows"
echo "$actual"
