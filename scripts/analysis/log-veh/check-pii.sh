#!/usr/bin/env bash
# check-pii.sh — SCEN-003 PII gate over committed artifacts.
#
# Two surfaces:
#   1. Report(s): must contain ZERO IPv4-value matches and ZERO email matches.
#   2. SQL file(s): `response_raw` must appear NOWHERE; every `source_ip` token must be
#      immediately inside an aggregate (only `COUNT(DISTINCT source_ip)` is allowed).
#
# Args: any number of paths to scan. With no args, defaults to the committed report
#       plus all scripts/analysis/log-veh/*.sql (resolved relative to this script).
#
# Exit non-zero on any violation, printing exactly what matched.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

IPV4_RE='\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b'
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
# source_ip is varchar(45) — IPv6-capable. Catch the unambiguous IPv6 shapes: a `::`
# compression marker next to a hextet, or 5+ colon-separated hextets (so HH:MM:SS times
# with only two colons never false-match). A backstop, not a full RFC 4291 validator.
IPV6_RE='(::[0-9A-Fa-f]{1,4}|[0-9A-Fa-f]{1,4}::|([0-9A-Fa-f]{1,4}:){4,}[0-9A-Fa-f]{1,4})'

DEFAULT_REPORT="$REPO_ROOT/docs/data-ops/2026-06-09-issue-45-phase3-analysis-log-veh/analysis-report.md"
# Phase 3.5 committed report bundle (PII-free aggregates over the Parquet snapshot).
DEFAULT_BUNDLE_P35="$REPO_ROOT/docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md"

violations=0
note() { printf '[pii] %s\n' "$*" >&2; }
flag() { printf '[pii][VIOLATION] %s\n' "$*" >&2; violations=$((violations+1)); }

# Build the target lists.
declare -a TARGETS
if (( $# > 0 )); then
  TARGETS=("$@")
else
  TARGETS=("$DEFAULT_REPORT" "$DEFAULT_BUNDLE_P35")
  # Phase 3 SQL (maxdepth 1) + Phase 3.5 report SQL in the reports/ subdir.
  while IFS= read -r f; do TARGETS+=("$f"); done \
    < <(find "$SCRIPT_DIR" -maxdepth 1 -name '*.sql' | sort)
  while IFS= read -r f; do TARGETS+=("$f"); done \
    < <(find "$SCRIPT_DIR/reports" -maxdepth 1 -name '*.sql' 2>/dev/null | sort)
fi

for path in "${TARGETS[@]}"; do
  if [[ ! -e "$path" ]]; then
    note "skip (not found yet): $path"
    continue
  fi
  note "scanning: $path"

  case "$path" in
    *.sql)
      # Scan EXECUTABLE SQL only: strip `-- ...` line comments first. Comments are
      # non-executable and cannot leak data values; the column-name controls below
      # (response_raw absent, source_ip aggregate-only) concern what the queries READ.
      # IPv4/email value patterns are still enforced on .sql below, comments included.
      code="$(sed -E 's/--.*$//' "$path")"

      # response_raw must appear nowhere in executable SQL (it is never read).
      if printf '%s\n' "$code" | grep -nE '\bresponse_raw\b' >/dev/null 2>&1; then
        flag "$path references response_raw in executable SQL:"
        printf '%s\n' "$code" | grep -nE '\bresponse_raw\b' >&2
      fi

      # Every bare `source_ip` column token must be inside COUNT(DISTINCT source_ip).
      # Use \b boundaries so aliases like `distinct_source_ips` do not false-match.
      while IFS= read -r line; do
        ln="${line%%:*}"
        body="${line#*:}"
        # Remove the sanctioned aggregate form, then look for any remaining bare token.
        stripped="$(printf '%s' "$body" | sed -E 's/COUNT\(\s*DISTINCT\s+source_ip\s*\)//gI')"
        if printf '%s' "$stripped" | grep -qE '\bsource_ip\b'; then
          flag "$path:$ln uses source_ip outside COUNT(DISTINCT source_ip): $body"
        fi
      done < <(printf '%s\n' "$code" | grep -nE '\bsource_ip\b' || true)

      # Value patterns (IPv4 / IPv6 / email) must not appear anywhere in the .sql, incl. comments.
      if grep -nEo "$IPV4_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains IPv4-value pattern:"
        grep -nEo "$IPV4_RE" "$path" >&2
      fi
      if grep -nEo "$IPV6_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains IPv6-value pattern:"
        grep -nEo "$IPV6_RE" "$path" >&2
      fi
      if grep -nEo "$EMAIL_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains email pattern:"
        grep -nEo "$EMAIL_RE" "$path" >&2
      fi
      ;;
    *)
      # Report (markdown / text): no IPv4/IPv6 values, no emails.
      if grep -nEo "$IPV4_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains IPv4-value pattern:"
        grep -nEo "$IPV4_RE" "$path" >&2
      fi
      if grep -nEo "$IPV6_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains IPv6-value pattern:"
        grep -nEo "$IPV6_RE" "$path" >&2
      fi
      if grep -nEo "$EMAIL_RE" "$path" >/dev/null 2>&1; then
        flag "$path contains email pattern:"
        grep -nEo "$EMAIL_RE" "$path" >&2
      fi
      # Defense in depth: report must not leak the raw PII column names as data either.
      if grep -nE 'response_raw' "$path" >/dev/null 2>&1; then
        flag "$path references response_raw"
      fi
      ;;
  esac
done

if (( violations > 0 )); then
  printf '[pii] FAILED with %d violation(s)\n' "$violations" >&2
  exit 1
fi
printf '[pii] OK — no PII violations across %d target(s)\n' "${#TARGETS[@]}" >&2
