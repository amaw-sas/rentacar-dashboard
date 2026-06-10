#!/usr/bin/env bash
# render-pdf.sh — orchestrate the issue #45 log_veh PDF report.
#
# Pipeline: compose self-contained report.html from the committed canonical markdown
# bundle + narrative + branch labels + theme, gate it through check-pii.sh, then render
# to a deterministic-named PDF via headless Chromium.
#
# Determinism: the output filename and all embedded content derive from the INPUT bundle
# (its filename date), NEVER from wall-clock `date`. reportDate is omitted on purpose.
#
# Inputs (committed, same dir): narrative.es.md, branch-labels.json, theme.css,
#   compose-html.mjs (+ parse-bundle.mjs, charts.mjs).
# Canonical bundle: docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-<date>.md
#
# Derived (gitignored): report.html, log-veh-reports-<date>.pdf
#
# On success: prints the PDF path; exits 0. On any failure: leaves no partial PDF; exits non-zero.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# pdf dir is 3 levels under repo root: scripts/analysis/log-veh/pdf
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

BUNDLE="$REPO_ROOT/docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md"

log() { printf '[render-pdf] %s\n' "$*" >&2; }
die() { printf '[render-pdf][ERROR] %s\n' "$*" >&2; exit 1; }

# 1. Assert the canonical bundle exists.
[[ -f "$BUNDLE" ]] || die "canonical bundle not found: $BUNDLE"

# 2. Derive the output date from the bundle FILENAME (deterministic, input-derived).
bundle_base="$(basename "$BUNDLE")"                 # log-veh-reports-2026-06-09.md
report_date="${bundle_base#log-veh-reports-}"       # 2026-06-09.md
report_date="${report_date%.md}"                    # 2026-06-09
[[ "$report_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] \
  || die "could not derive date from bundle filename: $bundle_base"
OUT="$SCRIPT_DIR/log-veh-reports-$report_date.pdf"
HTML="$SCRIPT_DIR/report.html"

# 3. Compose HTML to a temp file, then atomically mv to report.html.
tmp_html="$(mktemp "$SCRIPT_DIR/.report.XXXXXX.html")"
trap 'rm -f "$tmp_html"' EXIT
log "composing HTML from bundle: $bundle_base"
BUNDLE="$BUNDLE" \
NARRATIVE="$SCRIPT_DIR/narrative.es.md" \
LABELS="$SCRIPT_DIR/branch-labels.json" \
THEME="$SCRIPT_DIR/theme.css" \
TMP_HTML="$tmp_html" \
SCRIPT_DIR="$SCRIPT_DIR" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { BUNDLE, NARRATIVE, LABELS, THEME, TMP_HTML, SCRIPT_DIR } = process.env;
const { composeHtml } = await import(
  pathToFileURL(`${SCRIPT_DIR}/compose-html.mjs`).href
);

const bundleMd = readFileSync(BUNDLE, "utf8");
const narrativeMd = readFileSync(NARRATIVE, "utf8");
const themeCss = readFileSync(THEME, "utf8");
const branchLabels = JSON.parse(readFileSync(LABELS, "utf8"));

// reportDate omitted on purpose — keep the document deterministic.
const html = composeHtml({ bundleMd, narrativeMd, branchLabels, themeCss });
writeFileSync(TMP_HTML, html, "utf8");
NODE

[[ -s "$tmp_html" ]] || die "composed HTML is empty"

# 4. PII gate on the TEMP file BEFORE publishing to the stable name. A PII hit
#    must never reach a stable filename — gate first, then mv. The EXIT trap
#    removes the temp on die, so a failure leaves no artifact on disk.
log "running PII gate on composed HTML"
"$SCRIPT_DIR/../check-pii.sh" "$tmp_html" || die "PII gate failed on composed HTML — no artifact published"

# Publish atomically only after the gate passes.
mv -f "$tmp_html" "$HTML"
trap - EXIT
log "wrote: $HTML"

# 5. Resolve Chromium: PATH candidates, then Playwright cache globs.
CHROME=""
for cand in /usr/bin/chromium-browser /snap/bin/chromium chromium-browser chromium google-chrome google-chrome-stable; do
  if command -v "$cand" >/dev/null 2>&1; then CHROME="$cand"; break; fi
done
if [[ -z "$CHROME" ]]; then
  for g in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
           "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell; do
    if [[ -x "$g" ]]; then CHROME="$g"; break; fi
  done
fi
[[ -n "$CHROME" ]] || die "no Chromium binary found (PATH or Playwright cache)"
log "using Chromium: $CHROME"

# Render headless to PDF. Use an isolated user-data-dir to avoid profile clashes.
rm -f "$OUT"
chrome_profile="$(mktemp -d /tmp/render-pdf-profile.XXXXXX)"
trap 'rm -rf "$chrome_profile"' EXIT
"$CHROME" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="$chrome_profile" \
  --print-to-pdf="$OUT" \
  --no-pdf-header-footer \
  "file://$HTML" >/dev/null 2>&1 || true
rm -rf "$chrome_profile"
trap - EXIT

# 6. Validate: exists, non-empty, first 4 bytes == %PDF.
if [[ ! -s "$OUT" ]]; then
  rm -f "$OUT"
  die "PDF was not produced or is empty: $OUT"
fi
magic="$(head -c4 "$OUT")"
if [[ "$magic" != "%PDF" ]]; then
  rm -f "$OUT"
  die "output is not a valid PDF (first 4 bytes: '$magic'): $OUT"
fi

# 7. Success.
log "PDF written: $OUT"
printf '%s\n' "$OUT"
