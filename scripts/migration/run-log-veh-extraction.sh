#!/usr/bin/env bash
# Unattended launcher — issue #45 Phase 2 raw extraction of legacy log_veh.
#
# Fire-and-forget: detached-safe, RESUMABLE (fixed --run-dir), logged, writes a
# terminal STATUS sentinel, and removes its own cron line on a terminal outcome.
# Requires NO human interaction once started: the driver fetches creds (sudo cat)
# and owns its tunnel itself. The driver self-verifies completeness (exact
# reconciliation -> exit 0 / manifest complete:true).
#
# Run manually:   setsid nohup .../run-log-veh-extraction.sh >/dev/null 2>&1 &
# Or via cron (a line tagged with the CRON_MARK below) — see the install steps.
set -uo pipefail

REPO="/home/pabloandi/proyectos/amaw/rentacar/rentacar-dashboard"
WT="$REPO/.worktrees/issue-45-phase2-extract"
PY="$REPO/scripts/migration/.venv/bin/python"          # venv lives in the MAIN checkout
DRIVER="$WT/scripts/migration/extract-log-veh.py"
RUN_DIR="$WT/docs/migration-runs/log-veh-extract-unattended"  # FIXED -> resume; gitignored
LOG="$RUN_DIR/run.log"
STATUS="$RUN_DIR/STATUS"
CRON_MARK="log-veh-extract-unattended"                 # self-removal tag in the cron line
MAX_ATTEMPTS=6
RETRY_SLEEP=60

mkdir -p "$RUN_DIR"
log(){ echo "[$(date '+%F %T %z')] $*" >> "$LOG"; }
remove_cron(){ crontab -l 2>/dev/null | grep -v "$CRON_MARK" | crontab - 2>/dev/null || true; }

# Idempotent one-shot guard: a prior terminal outcome means do nothing.
if [ -f "$STATUS" ]; then
  s="$(cat "$STATUS" 2>/dev/null || true)"
  case "$s" in DONE|FATAL*) log "STATUS already '$s' — nothing to do"; remove_cron; exit 0;; esac
fi

log "=== launcher start (pid $$) host=$(hostname) ==="
for i in $(seq 1 "$MAX_ATTEMPTS"); do
  log "attempt $i/$MAX_ATTEMPTS -> extract-log-veh.py --run-dir <run_dir>"
  "$PY" "$DRIVER" --run-dir "$RUN_DIR" >> "$LOG" 2>&1
  rc=$?
  log "attempt $i exit=$rc"
  case "$rc" in
    0)  echo "DONE" > "$STATUS";                       log "SUCCESS — complete:true"; remove_cron; exit 0;;
    2)  echo "FATAL rc=2 cred/connection" > "$STATUS"; log "FATAL cred/connection (not resumable)"; remove_cron; exit 2;;
    4)  echo "FATAL rc=4 append-only" > "$STATUS";     log "FATAL append-only precondition (not resumable)"; remove_cron; exit 4;;
    3|5|6) log "resumable exit $rc — retry in ${RETRY_SLEEP}s (verified chunks preserved)"; sleep "$RETRY_SLEEP";;
    *)  log "unexpected exit $rc — retry in ${RETRY_SLEEP}s"; sleep "$RETRY_SLEEP";;
  esac
done
echo "EXHAUSTED after $MAX_ATTEMPTS attempts" > "$STATUS"
log "EXHAUSTED — escalate to a human"; remove_cron; exit 1
