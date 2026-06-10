#!/usr/bin/env bash
# render-markdown.sh — render a presentable Markdown variant of the issue #45 log_veh report.
#
# Pipeline: compose report.md from the committed canonical bundle + narrative + branch labels,
# gate it through check-pii.sh (on a temp file BEFORE publishing), then atomically move into place.
# No Chromium — Markdown needs no rendering engine.
#
# Determinism: all content derives from the INPUT bundle; no wall-clock date.
# Inputs (committed, same dir): narrative.es.md, branch-labels.json, compose-markdown.mjs (+ parse-bundle.mjs).
# Canonical bundle: docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-<date>.md
# Derived (gitignored): report.md
#
# On success: prints the report.md path; exits 0. On failure: leaves no artifact; exits non-zero.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BUNDLE="$REPO_ROOT/docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md"
OUT="$SCRIPT_DIR/report.md"

log() { printf '[render-markdown] %s\n' "$*" >&2; }
die() { printf '[render-markdown][ERROR] %s\n' "$*" >&2; exit 1; }

# 1. Assert the canonical bundle exists.
[[ -f "$BUNDLE" ]] || die "canonical bundle not found: $BUNDLE"

# Invalidate any prior published report up front, so a failed run never leaves a
# stale report.md behind (the file is gitignored/derived — safe to drop).
rm -f "$OUT"

# 2. Compose Markdown to a temp file.
tmp_md="$(mktemp "$SCRIPT_DIR/.report.XXXXXX.md")"
trap 'rm -f "$tmp_md"' EXIT
log "composing Markdown from bundle: $(basename "$BUNDLE")"
BUNDLE="$BUNDLE" \
NARRATIVE="$SCRIPT_DIR/narrative.es.md" \
LABELS="$SCRIPT_DIR/branch-labels.json" \
TMP_MD="$tmp_md" \
SCRIPT_DIR="$SCRIPT_DIR" \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { BUNDLE, NARRATIVE, LABELS, TMP_MD, SCRIPT_DIR } = process.env;
const { composeMarkdown } = await import(
  pathToFileURL(`${SCRIPT_DIR}/compose-markdown.mjs`).href
);

const md = composeMarkdown({
  bundleMd: readFileSync(BUNDLE, "utf8"),
  narrativeMd: readFileSync(NARRATIVE, "utf8"),
  branchLabels: JSON.parse(readFileSync(LABELS, "utf8")),
});
writeFileSync(TMP_MD, md, "utf8");
NODE

[[ -s "$tmp_md" ]] || die "composed Markdown is empty"

# 3. PII gate on the TEMP file BEFORE publishing to the stable name.
log "running PII gate on composed Markdown"
"$SCRIPT_DIR/../check-pii.sh" "$tmp_md" || die "PII gate failed on composed Markdown — no artifact published"

# 4. Publish atomically only after the gate passes.
mv -f "$tmp_md" "$OUT"
trap - EXIT
log "wrote: $OUT"
printf '%s\n' "$OUT"
