---
name: pdf-reports
created_by: claude-opus-4.8-via-brainstorming-skill
created_at: 2026-06-09T00:00:00Z
spec: docs/specs/2026-06-09-issue-45-pdf-reports-design.md
issue: 45
phase: pdf-reports
---

# Scenarios — log_veh PDF reports (Enfoque B)

Holdout contract for the log_veh management PDF report feature. Write-once after the first commit.
Weakening a scenario to match output is reward hacking — fix the code, not the contract.

Target: a PDF generation layer under `scripts/analysis/log-veh/pdf/` that is a **pure transformation
of the committed canonical markdown bundle** (`docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md`),
introducing **zero npm dependencies** and **zero changes to the merged Phase 3.5 pipeline**.

Pipeline: `parse-bundle.mjs` (markdown-table → structured `{report}{cut}{columns,rows}`, with a
fail-loud missing-cut guard) → `charts.mjs` (hand-rolled deterministic SVG: hbar/vbar/line,
integer-only coordinates) → `compose-html.mjs` (static branded HTML, `@page A4`, no JS) →
`render-pdf.sh` (assert bundle → compose HTML atomically → run `check-pii.sh` → Chromium
`--headless --print-to-pdf` → validate `%PDF`). Audience is Localiza/franchise management
(non-technical): charts + backing tables + Spanish narrative.

Validation surface: real execution. The parser runs against the **real committed bundle**; charts
and HTML are asserted for byte-determinism; the composed HTML is run through the **real
`check-pii.sh`**; the PDF is produced by the **real Chromium** present on this machine.

Key invariants:
- **PDF is a derived, gitignored, regenerable artifact;** the markdown bundle stays the single
  canonical versioned source. Re-running the pipeline reproduces the same HTML/SVG byte-for-byte.
- **Parser fidelity to the bundle.** DuckDB `-markdown` wraps every result set — including the
  `=== REPORT NN ===` / `--- NNx ---` section markers — as table **cells**. The parser must unwrap
  cells, skip synthetic `section`/`subsection` label rows and all separator rows, and reproduce the
  bundle's numbers exactly. A drifted number is wrong.
- **Fail-loud on missing data.** A bundle missing an expected `(report, cut)` pair makes
  `parse-bundle` throw — never silently render an empty/partial report.
- **PII-free by construction.** The composed HTML passes `check-pii.sh` (exit 0). Integer-only SVG
  coordinates guarantee no four-group dotted token can false-trip its IPv4 regex; committed text
  (narrative, labels) carries no `response_raw`/`source_ip` literal and no IPv4/IPv6/email.
- **Numbers shown = numbers in the bundle.** Chart data labels are the raw bundle integers with no
  locale separators / no `k`-abbreviation, so the literal value is assertable.

Anchors used below come from the committed bundle:
- 01a top branch: `AABOT = 63258` (share `9.525`).
- 01b month: `2025-12 = 48344` searches (share `7.279`).

---

## SCEN-001: render-pdf produces a real PDF plus its intermediate HTML

**Given**: the committed canonical bundle exists and Chromium is resolvable on this machine.
**When**: `scripts/analysis/log-veh/pdf/render-pdf.sh` runs to completion.
**Then**: the intermediate `report.html` exists, and a non-empty PDF whose first bytes are `%PDF`
is written to the configured output path; the script exits 0 and prints the PDF path.
**Evidence**: `head -c4 <pdf>` → `%PDF`; `test -s <pdf>` passes; `test -f report.html` passes;
script exit code `0`.

## SCEN-002: parser reproduces the bundle's numbers exactly

**Given**: the real committed bundle.
**When**: `parse-bundle.mjs` parses it.
**Then**: cut `01a` row for branch `AABOT` yields `searches = 63258`, and cut `01b` row for
`2025-12` yields `searches = 48344` — both via the typed `numAt` accessor (which returns a valid `0`
for a real `0`/`0.0` cell and throws only on `NaN`). The section markers do **not** appear as data
rows.
**Evidence**: a parse over the real bundle asserts `numAt(AABOT_row, 'searches') === 63258` and
`numAt(dec2025_row, 'searches') === 48344`; no parsed row has a value matching `^=== REPORT` or
`^--- \d`.

## SCEN-003: HTML + SVG output is byte-deterministic across runs

**Given**: the real bundle, unchanged between two runs.
**When**: `charts.mjs` chart emission and `compose-html.mjs` HTML composition run twice.
**Then**: the two `report.html` outputs (and the SVG fragments within) are byte-identical.
**Evidence**: `cmp -s run1/report.html run2/report.html` exits 0 (the PDF binary itself is excluded
from this check — Chromium embeds creation timestamps, same exclusion principle as Phase 3.5
SCEN-007's run-date line).

## SCEN-004: missing expected cut fails loud

**Given**: a bundle copy with one expected table (e.g. cut `01a`) removed.
**When**: `parse-bundle.mjs` parses it against its manifest of expected `(report, cut)` pairs.
**Then**: it throws a clear error naming the missing `(report, cut)` — it does not return a partial
structure or render an empty section.
**Evidence**: the parse call throws; the error message contains the missing pair identifier (e.g.
`01a`).

## SCEN-005: composed HTML is PII-free under the real scanner

**Given**: the real composed `report.html` (charts + backing tables + Spanish narrative).
**When**: `check-pii.sh report.html` runs.
**Then**: it exits `0` — no IPv4/IPv6/email, no `response_raw`/`source_ip` literal — proving the
integer-coordinate SVG invariant keeps chart geometry from false-tripping the IPv4 regex.
**Evidence**: `check-pii.sh report.html` exit code `0`; and `charts.mjs` emits no `<text>`/coordinate
token matching `[0-9]{1,3}(\.[0-9]{1,3}){3}`.

## SCEN-006: each report section carries its Spanish narrative

**Given**: the composed `report.html`.
**When**: the HTML is inspected per report section (R01–R04).
**Then**: each section contains its Spanish narrative sentinel phrase (one assertable phrase per
section, authored in Spanish and run through `/humanizer`).
**Evidence**: for each of the 4 report sections, its sentinel substring is present in `report.html`.

## SCEN-007: the PDF and intermediate HTML are gitignored

**Given**: the repo `.gitignore` after this feature.
**When**: `git check-ignore` is run on the generated artifacts.
**Then**: `scripts/analysis/log-veh/pdf/report.html` and `scripts/analysis/log-veh/pdf/*.pdf` are
ignored — the canonical markdown bundle is **not** ignored.
**Evidence**: `git check-ignore scripts/analysis/log-veh/pdf/report.html` and a `.pdf` path both
print the path (exit 0); `git check-ignore` on the bundle path exits non-zero.

## SCEN-008: chart numeric labels equal the bundle values verbatim

**Given**: the R01 searches-per-month line chart built from cut `01b`.
**When**: `charts.mjs` emits the chart for the `2025-12` data point.
**Then**: the emitted SVG contains a `<text>` label with the literal substring `48344` — the raw
bundle integer, with no thousands separator, no decimal, no `k`-abbreviation, no locale formatting.
**Evidence**: the line-chart SVG string contains `>48344<` (or an equivalent assertable
raw-integer `<text>` node); it does **not** contain `48,344` / `48.344` / `48.3k`.
