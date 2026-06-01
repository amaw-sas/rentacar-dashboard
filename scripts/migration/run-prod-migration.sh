#!/usr/bin/env bash
#
# run-prod-migration.sh — guarded launcher for the legacy→destination ETL (issue #23).
#
# Orchestrates the existing Python ETL scripts (preflight → customers → reservations)
# behind a set of safety guards. The ETL scripts themselves have NO destination
# ref-guard: the only thing separating a disposable branch from production is the
# value of SUPABASE_DB_URL. This launcher encodes the safeguard that, during the
# #22 dry-run, lived only inline in the operator's shell.
#
# USAGE
#   run-prod-migration.sh --expect-ref <project_ref> (--dry-run | --commit) \
#                         [--snapshot-confirmed] [--env-file <path>]
#
#   --expect-ref <ref>      REQUIRED. The destination project ref the operator
#                           intends to hit (e.g. ilhdholjrnbycyvejsub for prod,
#                           cwxdnfixnoqkgrvrbssu for the disposable branch). The
#                           launcher parses SUPABASE_DB_URL and ABORTS unless the
#                           ref embedded in the connection string matches.
#   --dry-run               Read + compute, ROLLBACK. Writes nothing. Safe to run
#                           against prod as the final rehearsal. (default if neither
#                           --dry-run nor --commit is given)
#   --commit                Real run: COMMITs each ETL if its gate passes. REQUIRES
#                           --snapshot-confirmed.
#   --snapshot-confirmed    Operator attestation that a manual Supabase snapshot was
#                           taken. Required for --commit; ignored for --dry-run.
#   --env-file <path>       Source this env file (set -a) before running. If omitted,
#                           the 5 required vars must already be exported.
#
# EXIT
#   0  all stages succeeded (dry-run completed, or commit + verify passed)
#   1  a guard aborted, or a downstream stage failed (see message)
#   The underlying ETL exit codes (2 conn / 3 query / 4 env / 5 report / 6 uncaught /
#   7 commit-gate-failed→ROLLBACK) are surfaced verbatim when a stage fails.
#   preflight-check.py also returns 1 on reference-data gaps (unresolvable
#   franchise/branch/category/id_type) — a real FK-resolution blocker, so the
#   chain aborts exactly as it does for the launcher's own guard-abort code 1.
#
# This launcher reads SUPABASE_DB_URL but NEVER prints the password. Only the parsed
# project ref and port are echoed (neither is secret).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$SCRIPT_DIR/.venv/bin/python"
VERIFY_SQL="$SCRIPT_DIR/verify-prod-run.sql"

REQUIRED_ENV=(LEGACY_DB_HOST LEGACY_DB_USER LEGACY_DB_PASSWORD LEGACY_DB_NAME SUPABASE_DB_URL)

# --------------------------------------------------------------------------- #
# Logging                                                                      #
# --------------------------------------------------------------------------- #
log()  { printf '\033[0;36m[run]\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[0;32m[ok ]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31m[abort]\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------- #
# Args                                                                         #
# --------------------------------------------------------------------------- #
EXPECT_REF=""
MODE=""
SNAPSHOT_CONFIRMED=0
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-ref)        EXPECT_REF="${2:-}"; shift 2 ;;
    --expect-ref=*)      EXPECT_REF="${1#*=}"; shift ;;
    --dry-run)           MODE="dry-run"; shift ;;
    --commit)            MODE="commit"; shift ;;
    --snapshot-confirmed) SNAPSHOT_CONFIRMED=1; shift ;;
    --env-file)          ENV_FILE="${2:-}"; shift 2 ;;
    --env-file=*)        ENV_FILE="${1#*=}"; shift ;;
    -h|--help)           sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                   die "unknown argument: $1 (try --help)" ;;
  esac
done

[[ -z "$MODE" ]] && MODE="dry-run"
[[ -z "$EXPECT_REF" ]] && die "--expect-ref <project_ref> is required (try --help)"

# Optionally source the env file (set -a exports everything it defines).
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || die "--env-file not found: $ENV_FILE"
  log "sourcing env from $ENV_FILE"
  set -a; . "$ENV_FILE"; set +a
fi

# --------------------------------------------------------------------------- #
# Guard 1 — env: all 5 vars present and non-empty                              #
# --------------------------------------------------------------------------- #
missing=()
for v in "${REQUIRED_ENV[@]}"; do
  [[ -n "${!v:-}" ]] || missing+=("$v")
done
[[ ${#missing[@]} -eq 0 ]] || die "missing/empty required env var(s): ${missing[*]}"
ok "env: 5 required vars present"

# --------------------------------------------------------------------------- #
# Guard 2 — ref: the project ref in SUPABASE_DB_URL must equal --expect-ref    #
# Parse the USERNAME only (postgres.<ref>), bounded by the first ':'. The      #
# password (after that ':') is never read, so a '@' or ':' in it can't fool    #
# the parser.                                                                  #
# --------------------------------------------------------------------------- #
url="$SUPABASE_DB_URL"
userinfo="${url#*://}"          # strip scheme  -> postgres.<ref>:<pw>@host:port/db
userinfo="${userinfo%%@*}"      # strip @host…  -> postgres.<ref>:<pw>
dbuser="${userinfo%%:*}"        # strip :<pw>   -> postgres.<ref>   (or 'postgres' direct-conn)
actual_ref=""
case "$dbuser" in
  postgres.*) actual_ref="${dbuser#postgres.}" ;;            # pooler: postgres.<ref>
  *)
    # direct connection: ref lives in the host db.<ref>.supabase.co. Strip to the
    # LAST '@' (##*@), not the first, so a literal '@' in the password can't land
    # us inside it — same strategy guard 3 uses for the port.
    hostport="${url##*@}"; host="${hostport%%[:/]*}"
    case "$host" in
      db.*.supabase.co) actual_ref="${host#db.}"; actual_ref="${actual_ref%%.*}" ;;
    esac
    ;;
esac
[[ -n "$actual_ref" ]] || die "could not parse a project ref from SUPABASE_DB_URL (expected pooler user postgres.<ref> or host db.<ref>.supabase.co)"
if [[ "$actual_ref" != "$EXPECT_REF" ]]; then
  die "destination ref mismatch: SUPABASE_DB_URL points to '$actual_ref' but --expect-ref is '$EXPECT_REF'. Refusing to run."
fi
ok "ref: destination is '$actual_ref' (matches --expect-ref)"

# --------------------------------------------------------------------------- #
# Guard 3 — port: recommend the transaction pooler (6543). The #22 dry-run found #
# the session pooler (5432) rejected auth INTERMITTENTLY with that branch        #
# credential; 6543 connected 8/8. But #19's prod customers run used 5432 and     #
# succeeded — so 5432 is not categorically broken. Warn loudly, never abort:     #
# a flaky-port failure surfaces immediately as a connection error (exit 2), and  #
# hard-blocking would refuse a config that has worked against prod.              #
# Extract the port from the segment after the last '@'.                          #
# --------------------------------------------------------------------------- #
afterhost="${url##*@}"          # host:port/db…  (last @ avoids '@' in password)
if [[ "$afterhost" == *:* ]]; then
  port="${afterhost#*:}"; port="${port%%/*}"; port="${port%%\?*}"
else
  port=""                       # no explicit port -> libpq default (5432)
fi
if [[ "$port" == "6543" ]]; then
  ok "port: 6543 (transaction pooler)"
elif [[ "$port" == "5432" || -z "$port" ]]; then
  log "warning: SUPABASE_DB_URL uses the session pooler (${port:-implicit :5432}). The #22 dry-run saw it reject auth intermittently; the transaction pooler (:6543) is preferred and the ETL is single-transaction compatible. Continuing."
else
  log "warning: destination port is '$port' (expected 6543, the transaction pooler). Continuing."
fi

# --------------------------------------------------------------------------- #
# Guard 4 — snapshot: --commit requires the operator's snapshot attestation    #
# --------------------------------------------------------------------------- #
if [[ "$MODE" == "commit" && "$SNAPSHOT_CONFIRMED" -ne 1 ]]; then
  die "--commit requires --snapshot-confirmed (take a manual Supabase snapshot first, then attest it)."
fi

# --------------------------------------------------------------------------- #
# Guard 5 — column: reservations._legacy_id must exist (migration 050 applied) #
# Uses the venv interpreter + psycopg2; reads SUPABASE_DB_URL from env. The     #
# venv is only needed from here on (guards 1-4 are pure shell), so it's         #
# validated at this point rather than up front.                                #
# --------------------------------------------------------------------------- #
[[ -x "$PYTHON" ]] || die "venv interpreter not found/executable: $PYTHON (create scripts/migration/.venv)"
log "checking migration 050 marker column on the destination…"
if ! "$PYTHON" - <<'PYEOF'
import os, sys
import psycopg2
try:
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=10)
except Exception as exc:  # noqa: BLE001
    sys.stderr.write(f"connect failed: {type(exc).__name__}\n")
    sys.exit(2)
with conn, conn.cursor() as cur:
    cur.execute("""
        select 1 from information_schema.columns
        where table_schema='public' and table_name='reservations'
          and column_name='_legacy_id'
    """)
    found = cur.fetchone() is not None
conn.close()
sys.exit(0 if found else 3)
PYEOF
then
  die "reservations._legacy_id not found on destination (or connect failed). Apply migration 050 first, then retry."
fi
ok "column: reservations._legacy_id present (migration 050 applied)"

# --------------------------------------------------------------------------- #
# Stage runner                                                                 #
# --------------------------------------------------------------------------- #
run_stage() {
  local label="$1"; shift
  log "── $label ──"
  if "$@"; then
    ok "$label → exit 0"
  else
    local rc=$?
    die "$label FAILED (exit $rc). Chain stopped; nothing further runs."
  fi
}

CUSTOMERS="$SCRIPT_DIR/etl-customers.py"
RESERVATIONS="$SCRIPT_DIR/etl-reservations.py"
PREFLIGHT="$SCRIPT_DIR/preflight-check.py"

log "mode=$MODE  destination=$actual_ref"

# --------------------------------------------------------------------------- #
# verify-prod-run.sql runner (PASS/FAIL gate)                                  #
# --------------------------------------------------------------------------- #
run_verify() {
  log "── verify-prod-run.sql ──"
  if ! "$PYTHON" - "$VERIFY_SQL" <<'PYEOF'
import os, sys
import psycopg2
sql_path = sys.argv[1]
with open(sql_path, "r", encoding="utf-8") as fh:
    sql = fh.read()
conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=10)
failed = 0
with conn, conn.cursor() as cur:
    cur.execute(sql)
    rows = cur.fetchall()
    width = max((len(r[0]) for r in rows), default=10)
    for name, detail, status in rows:
        mark = {"PASS": "PASS", "FAIL": "FAIL", "INFO": "info"}.get(status, status)
        print(f"  [{mark:4}] {name:<{width}}  {detail}")
        if status == "FAIL":
            failed += 1
conn.close()
sys.exit(1 if failed else 0)
PYEOF
  then
    die "verify-prod-run.sql reported FAIL row(s). Investigate before sign-off."
  fi
  ok "verify: all assertions PASS"
}

# --------------------------------------------------------------------------- #
# Sequence                                                                     #
# --------------------------------------------------------------------------- #
if [[ "$MODE" == "dry-run" ]]; then
  run_stage "preflight"          "$PYTHON" "$PREFLIGHT"
  run_stage "customers (dry-run)"    "$PYTHON" "$CUSTOMERS"    --dry-run
  run_stage "reservations (dry-run)" "$PYTHON" "$RESERVATIONS" --dry-run
  ok "DRY-RUN complete — nothing written. Review the per-stage reconciliation above."
else
  run_stage "preflight"          "$PYTHON" "$PREFLIGHT"
  run_stage "customers (commit)"     "$PYTHON" "$CUSTOMERS"
  run_stage "reservations (commit)"  "$PYTHON" "$RESERVATIONS"
  run_verify
  ok "COMMIT complete and verified. Write docs/migration-runs/prod-<timestamp>.md next."
fi
