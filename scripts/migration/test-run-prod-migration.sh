#!/usr/bin/env bash
#
# test-run-prod-migration.sh — offline scenario tests for the launcher guards.
#
# Encodes SDD scenarios SCEN-1..4 (issue #23). These guards (env, ref, port,
# snapshot) all short-circuit BEFORE any DB connection, so the tests are fully
# deterministic and need no database, no credentials, and no network. SCEN-5
# (column-guard) and SCEN-6 (ordering / full dry-run) touch a live DB and are
# validated against the disposable branch during the rehearsal (see prod-runbook.md).
#
# Run:  bash scripts/migration/test-run-prod-migration.sh
# Exit: 0 if all scenarios pass, 1 otherwise.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$DIR/run-prod-migration.sh"

PROD_REF="prodref0000000000000"
BRANCH_REF="branchref000000000000"
POOLER_6543="postgresql://postgres.${PROD_REF}:p%40ss:w0rd@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
POOLER_5432="postgresql://postgres.${PROD_REF}:p%40ss:w0rd@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
BRANCH_6543="postgresql://postgres.${BRANCH_REF}:p%40ss:w0rd@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

pass=0; fail=0

# run_case <name> <expected_substring> <env-assignments...> -- <launcher-args...>
run_case() {
  local name="$1" expect="$2"; shift 2
  local -a envassign=() args=()
  local seen_sep=0
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then seen_sep=1; shift; continue; fi
    if [[ $seen_sep -eq 0 ]]; then envassign+=("$1"); else args+=("$1"); fi
    shift
  done
  local out rc
  out="$(env -i PATH="$PATH" "${envassign[@]}" bash "$LAUNCHER" "${args[@]}" 2>&1)"; rc=$?
  if [[ $rc -ne 0 ]] && grep -qF -- "$expect" <<<"$out"; then
    printf '\033[0;32mPASS\033[0m  %s\n' "$name"; pass=$((pass+1))
  else
    printf '\033[0;31mFAIL\033[0m  %s\n      expected abort containing: %s\n      got (rc=%s): %s\n' \
      "$name" "$expect" "$rc" "$(tail -1 <<<"$out")"; fail=$((fail+1))
  fi
}

# assert_passthrough <name> <env...> -- <args...>
# Proves guards 1-4 cleared: the run emits the guard-2 and guard-3 OK lines before
# stopping later (at the venv/column guard). Final rc is irrelevant.
assert_passthrough() {
  local name="$1"; shift
  local -a envassign=() args=(); local seen_sep=0
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then seen_sep=1; shift; continue; fi
    if [[ $seen_sep -eq 0 ]]; then envassign+=("$1"); else args+=("$1"); fi
    shift
  done
  local out
  out="$(env -i PATH="$PATH" "${envassign[@]}" bash "$LAUNCHER" "${args[@]}" 2>&1)" || true
  if grep -qF "matches --expect-ref" <<<"$out" && grep -qF "port: 6543" <<<"$out"; then
    printf '\033[0;32mPASS\033[0m  %s\n' "$name"; pass=$((pass+1))
  else
    printf '\033[0;31mFAIL\033[0m  %s\n      expected guard-2 + guard-3 OK lines\n      got: %s\n' \
      "$name" "$out"; fail=$((fail+1))
  fi
}

ALL_ENV=(
  LEGACY_DB_HOST=h LEGACY_DB_USER=u LEGACY_DB_PASSWORD=pw LEGACY_DB_NAME=db
)

echo "── SCEN-1..4 (offline guard scenarios) ──"

# SCEN-4: missing env var (drop SUPABASE_DB_URL entirely)
run_case "SCEN-4 missing env aborts" "missing/empty required env var" \
  "${ALL_ENV[@]}" -- --expect-ref "$PROD_REF" --dry-run

# SCEN-1: ref mismatch (URL points to branch, expect prod)
run_case "SCEN-1 ref mismatch aborts" "destination ref mismatch" \
  "${ALL_ENV[@]}" "SUPABASE_DB_URL=$BRANCH_6543" -- --expect-ref "$PROD_REF" --dry-run

# SCEN-2: session pooler port 5432 → WARN and continue (not abort). #19's prod run
# used 5432 successfully, so it's not categorically blocked. Assert the warning is
# emitted AND guard 3 is cleared (the run stops later, at the snapshot guard).
scen2_out="$(env -i PATH="$PATH" "${ALL_ENV[@]}" "SUPABASE_DB_URL=$POOLER_5432" \
  bash "$LAUNCHER" --expect-ref "$PROD_REF" --commit 2>&1)" || true
if grep -qF "session pooler" <<<"$scen2_out" \
   && grep -qF "requires --snapshot-confirmed" <<<"$scen2_out"; then
  printf '\033[0;32mPASS\033[0m  SCEN-2 port 5432 warns + continues (stops at snapshot guard)\n'; pass=$((pass+1))
else
  printf '\033[0;31mFAIL\033[0m  SCEN-2 port 5432 warn+continue\n      got: %s\n' "$scen2_out"; fail=$((fail+1))
fi

# SCEN-3: --commit without --snapshot-confirmed (ref+port ok)
run_case "SCEN-3 commit needs snapshot" "requires --snapshot-confirmed" \
  "${ALL_ENV[@]}" "SUPABASE_DB_URL=$POOLER_6543" -- --expect-ref "$PROD_REF" --commit

# Missing --expect-ref entirely
run_case "missing --expect-ref aborts" "--expect-ref <project_ref> is required" \
  "${ALL_ENV[@]}" "SUPABASE_DB_URL=$POOLER_6543" -- --dry-run

# Guards 1-4 PASS-THROUGH: matching ref + 6543 + dry-run clears guards 1-4; the run
# only stops later (venv/column guard). Asserting the guard-2/3 OK lines proves it.
assert_passthrough "guards 1-4 pass-through (ref+port OK lines emitted)" \
  "${ALL_ENV[@]}" "SUPABASE_DB_URL=$POOLER_6543" -- --expect-ref "$PROD_REF" --dry-run

echo
echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
