#!/usr/bin/env bash
# Provision a throwaway, socket-only MariaDB server for log_veh Phase 3 analysis.
#
# Preflight: require the server binaries and a disk floor on the datadir filesystem.
# The server listens on a Unix socket only (--skip-networking) so the loaded PII is
# never reachable over TCP. Idempotent-ish: if the socket already answers, reuse it.
#
# Env / args (env wins; defaults shown):
#   DATADIR   default /tmp/log-veh-analysis-db/data
#   SOCKET    default /tmp/log-veh-analysis-db/mysqld.sock
#   MIN_FREE_GIB  default 60
#
# On success: emits the socket path on stdout (last line) and exits 0.
set -Eeuo pipefail

DATADIR="${DATADIR:-/tmp/log-veh-analysis-db/data}"
SOCKET="${SOCKET:-/tmp/log-veh-analysis-db/mysqld.sock}"
MIN_FREE_GIB="${MIN_FREE_GIB:-60}"

log() { printf '[provision] %s\n' "$*" >&2; }
die() { printf '[provision][ERROR] %s\n' "$*" >&2; exit 1; }

# --- Reuse path: socket already answering ---------------------------------
if [[ -S "$SOCKET" ]] && mariadb-admin --socket="$SOCKET" ping >/dev/null 2>&1; then
  log "MariaDB already answering on $SOCKET — reusing."
  echo "$SOCKET"
  exit 0
fi

# --- Preflight: binaries ---------------------------------------------------
for bin in mariadbd mariadb-install-db mariadb-admin mariadb; do
  command -v "$bin" >/dev/null 2>&1 || die "required binary not found: $bin"
done
log "binaries present: mariadbd mariadb-install-db mariadb-admin mariadb"

# --- Preflight: disk floor on the datadir filesystem -----------------------
mkdir -p "$DATADIR"
avail_gib="$(df -BG --output=avail "$DATADIR" | tail -1 | tr -dc '0-9')"
[[ -n "$avail_gib" ]] || die "could not determine free space on $DATADIR"
if (( avail_gib < MIN_FREE_GIB )); then
  die "insufficient disk: ${avail_gib} GiB free on $(df -P "$DATADIR" | tail -1 | awk '{print $6}'), need >= ${MIN_FREE_GIB} GiB"
fi
log "disk ok: ${avail_gib} GiB free (floor ${MIN_FREE_GIB} GiB)"

# --- Install system tables (skip if datadir already initialized) -----------
if [[ ! -d "$DATADIR/mysql" ]]; then
  log "installing system tables into $DATADIR"
  mariadb-install-db \
    --datadir="$DATADIR" \
    --auth-root-authentication-method=normal \
    --skip-test-db >/dev/null 2>&1 || die "mariadb-install-db failed"
else
  log "datadir already initialized — skipping install"
fi

# --- Start the server: socket-only, no grant tables, no TCP ----------------
mkdir -p "$(dirname "$SOCKET")"
log "starting mariadbd (socket-only, skip-networking) ..."
# Throwaway-loader tuning: durability is worthless here — a crash just means re-loading
# from the gz archive, which costs nothing — so trade it for speed. Dropping the per-commit
# redo fsync and the doublewrite buffer is the highest-leverage change for the fsync-bound
# bulk load and the materialize writes. Buffer pool is sized modestly to avoid OOM on small
# hosts (override with INNODB_BUFFER_POOL_SIZE).
INNODB_BUFFER_POOL_SIZE="${INNODB_BUFFER_POOL_SIZE:-2G}"
mariadbd \
  --datadir="$DATADIR" \
  --socket="$SOCKET" \
  --pid-file="$(dirname "$SOCKET")/mysqld.pid" \
  --skip-networking \
  --skip-grant-tables \
  --innodb-flush-log-at-trx-commit=0 \
  --innodb-doublewrite=0 \
  --innodb-buffer-pool-size="$INNODB_BUFFER_POOL_SIZE" \
  >"$(dirname "$SOCKET")/mariadbd.log" 2>&1 &

# --- Wait for the socket to answer (bounded) -------------------------------
for _ in $(seq 1 60); do
  if mariadb-admin --socket="$SOCKET" ping >/dev/null 2>&1; then
    log "server up on $SOCKET"
    echo "$SOCKET"
    exit 0
  fi
  sleep 1
done
die "server did not answer on $SOCKET within 60s (see $(dirname "$SOCKET")/mariadbd.log)"
