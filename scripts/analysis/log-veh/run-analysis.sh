#!/usr/bin/env bash
# run-analysis.sh — single entry point for the log_veh Phase 3 analysis pipeline.
#
# Stages: provision -> load (+reconcile) -> materialize -> run queries -> teardown.
# The query output is captured to a PII-free /tmp results file (aggregates only); the
# path is printed at the end. The throwaway datadir is deleted by teardown regardless.
#
# Env / args (env wins; defaults shown):
#   DATADIR      default /tmp/log-veh-analysis-db/data
#   SOCKET       default /tmp/log-veh-analysis-db/mysqld.sock
#   DB           default analysis
#   ARCHIVE_DIR  default: the Phase 2 worktree archive
#   RESULTS      default /tmp/log-veh-analysis-results.txt
#   MAX_CHUNKS   optional: load only the first N chunks (smoke test)
#   EXPECTED_ROWS optional: override the reconcile target
#   KEEP_DB      optional: if set to 1, skip teardown (debug only)
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export DATADIR="${DATADIR:-/tmp/log-veh-analysis-db/data}"
export SOCKET="${SOCKET:-/tmp/log-veh-analysis-db/mysqld.sock}"
export DB="${DB:-analysis}"
RESULTS="${RESULTS:-/tmp/log-veh-analysis-results.txt}"

log() { printf '[run] %s\n' "$*" >&2; }

cleanup() {
  if [[ "${KEEP_DB:-0}" == "1" ]]; then
    log "KEEP_DB=1 — leaving server + datadir up for debugging"
    return
  fi
  log "tearing down"
  DATADIR="$DATADIR" SOCKET="$SOCKET" bash "$SCRIPT_DIR/teardown.sh" || true
}
trap cleanup EXIT

# Five numbered stages run here; teardown is the 6th, fired by the EXIT trap above
# (so it runs even if a stage fails).
log "stage 1/5 — provision"
bash "$SCRIPT_DIR/provision-db.sh"

log "stage 2/5 — load + reconcile"
bash "$SCRIPT_DIR/load-archive.sh"

log "stage 3/5 — materialize helper tables"
mariadb --socket="$SOCKET" "$DB" < "$SCRIPT_DIR/materialize.sql"

log "stage 4/5 — run analysis queries -> $RESULTS"
mariadb --socket="$SOCKET" --table "$DB" < "$SCRIPT_DIR/analysis-queries.sql" > "$RESULTS"

# Load-bearing PII gate: scan the actual run output + the committed SQL. Fails the run
# (non-zero, no `|| true`) if any PII value or disallowed column reference slips through,
# so a botched query can never silently produce a leaky results file to transcribe from.
log "stage 5/5 — PII gate over results + SQL"
bash "$SCRIPT_DIR/check-pii.sh" "$RESULTS" "$SCRIPT_DIR"/materialize.sql "$SCRIPT_DIR"/analysis-queries.sql

log "analysis complete — results at: $RESULTS"
echo "$RESULTS"
