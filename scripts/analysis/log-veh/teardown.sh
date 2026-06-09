#!/usr/bin/env bash
# teardown.sh — shut down the throwaway MariaDB and delete its datadir.
#
# Harness-safe: NEVER `kill`, NEVER `rm -rf`. Uses `mariadb-admin shutdown` and
# `find … -delete`. Idempotent: ok if the server is already down / datadir already gone.
#
# Env / args (env wins; defaults shown):
#   DATADIR  default /tmp/log-veh-analysis-db/data
#   SOCKET   default /tmp/log-veh-analysis-db/mysqld.sock
set -Eeuo pipefail

DATADIR="${DATADIR:-/tmp/log-veh-analysis-db/data}"
SOCKET="${SOCKET:-/tmp/log-veh-analysis-db/mysqld.sock}"

log() { printf '[teardown] %s\n' "$*" >&2; }
die() { printf '[teardown][ERROR] %s\n' "$*" >&2; exit 1; }

# --- Shut the server down via admin (graceful, no kill) -------------------
if [[ -S "$SOCKET" ]] && mariadb-admin --socket="$SOCKET" ping >/dev/null 2>&1; then
  log "shutting down server on $SOCKET"
  mariadb-admin --socket="$SOCKET" shutdown || log "shutdown returned non-zero (continuing)"
  # Wait (bounded) for the socket to stop answering.
  for _ in $(seq 1 30); do
    mariadb-admin --socket="$SOCKET" ping >/dev/null 2>&1 || break
    sleep 1
  done
else
  log "no live server on $SOCKET — nothing to shut down"
fi

# --- Refuse to delete the datadir out from under a still-live server -------
# If graceful shutdown stalled past the wait, deleting InnoDB files under a running
# mariadbd is unsound (writes to unlinked inodes). Abort rather than race it.
if [[ -S "$SOCKET" ]] && mariadb-admin --socket="$SOCKET" ping >/dev/null 2>&1; then
  die "server still answering on $SOCKET after shutdown wait — refusing to delete datadir under a live server"
fi

# --- Remove the datadir tree (files first, then dirs) ----------------------
if [[ -d "$DATADIR" ]]; then
  log "deleting datadir tree: $DATADIR"
  find "$DATADIR" -type f -delete
  find "$DATADIR" -depth -type d -delete
else
  log "datadir already gone: $DATADIR"
fi

# --- Remove the parent scratch dir if now empty (socket, logs, pid) --------
parent="$(dirname "$SOCKET")"
if [[ -d "$parent" ]]; then
  find "$parent" -type f -delete 2>/dev/null || true
  find "$parent" -depth -type d -empty -delete 2>/dev/null || true
fi

log "teardown complete"
