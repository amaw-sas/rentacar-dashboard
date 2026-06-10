# Design — log_veh PDF reports (issue #45)

**Date:** 2026-06-09
**Status:** approved (brainstorming)
**Scope:** generate a management-facing PDF from the canonical Phase 3.5 markdown report bundle.

## 1. Problem

Phase 3.5 (PR #112, merged `b1d09de`) produced a canonical, PII-free, reconciled **markdown** report bundle:
`docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md` — four reports of raw
DuckDB tables (demand, pricing, quote-failure, availability/behavior).

Raw markdown tables of branch codes and quantiles do not communicate to a non-technical audience (Localiza /
franchise management). They need a presentable PDF with charts, an executive narrative in Spanish, and the
backing tables for honesty.

## 2. Goals / Non-goals

**Goals**
- A branded PDF, in Spanish, with charts + executive narrative + backing tables, one section per report.
- Derived purely from the canonical markdown bundle — no re-query of DuckDB/Parquet at PDF time.
- Zero changes to merged Phase 3.5 code (minimal blast radius).
- Zero new runtime dependencies (hand-rolled SVG + markdown-table parser; Chromium via `child_process`).
- Deterministic at the HTML+SVG layer; PDF is a gitignored, regenerable derived artifact.

**Non-goals**
- No new analytical numbers — the PDF only re-presents what the canonical bundle already reconciled.
- No interactivity, no JS in the rendered document (static HTML → print).
- No committed PDF binary (breaks byte-determinism; embeds Chromium timestamps).
- No coupling to `public.search_logs` or the productive ETL.

## 3. Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Audience | Gerencia / non-technical | Justifies branding, charts, narrative |
| Visual level | Charts + tables + narrative | Maximum communication |
| Language | Spanish | CLAUDE.md: user-facing strings are Spanish |
| Persistence | PDF regenerable, markdown canonical | Preserves Phase 3.5 determinism; no binary diffs |
| Engine | Static SVG → static HTML → Chromium `--print-to-pdf` | Only available engine (no pandoc/LaTeX); no JS-render race; deterministic |
| Data source | Parse the committed markdown bundle | Single canonical source; no Parquet at PDF time; zero changes to merged code |

## 4. Architecture

```
bundle markdown (canonical, PII-free)  ──┐
                                         ▼
  [1] parse-bundle.mjs   markdown → { report → cut → rows[] }
                                         │
   narrative.es.md  ──────────────┐      │
   branch-labels.json ────────────┤      ▼
                                   │  [2] charts.mjs   deterministic SVG (hbar/vbar/line)
                                   │      │
                                   └─────►│
                                         ▼
  [3] compose-html.mjs   static HTML (branded CSS, @page A4, NO JS)  → report.html (gitignored)
                                         ▼
  [4] render-pdf.sh   chromium --headless --print-to-pdf  → log-veh-reports-<date>.pdf (gitignored)
```

Runtime: Node `.mjs`, no npm deps. Chromium resolved like `generate-reports.sh` resolves duckdb
(Playwright chromium under `~/.cache/ms-playwright/`, or system `chromium`/`chromium-browser`).

## 5. Components

Each is a single responsibility, testable in isolation. The three pure modules (`parse-bundle`, `charts`,
`compose-html`) have no I/O side effects — they are string-in / string-out, which is what makes determinism
testable.

### 5.1 `parse-bundle.mjs`
State machine over the bundle's **stable markers**. Critical format fact: DuckDB `-markdown` wraps *every*
result set as a markdown table, so the section/subsection markers are **table cells**, not bare lines. The real
bundle looks like:

```
|                       section                        |
|------------------------------------------------------|
| === REPORT 01: demand by branch + month + routes === |
|                             subsection                             |
|--------------------------------------------------------------------|
| --- 01a: top pickup branches (denominator: all rows = 664,126) --- |
| pickup_location | searches | pct_of_all |
|-----------------|---------:|-----------:|
| AABOT           | 63258    | 9.525      |
```

**Parser contract (per table row):** trim leading/trailing `|` and collapse whitespace to get the cell content.
Then:
- If the unwrapped single-cell content matches `^=== REPORT (\d+):` → set current report, do **not** emit a data row.
- If it matches `^--- (\d+[a-z]):` → set current cut, do **not** emit a data row.
- Skip the synthetic single-column header label rows (`section`, `subsection`) and **all** separator rows
  (`|---|`, including the `---:` right-aligned form). These are never data.
- Otherwise the row belongs to the current `(report, cut)` as data; the first such row after a cut marker is the
  column header, the rest are values.

Output: `{ "01": { "01a": { columns: [...], rows: [[...]] }, ... }, ... }`.

**Fail loud:** if any expected `(report, cut)` listed in an explicit manifest constant is absent, throw a clear
error naming the missing cut. No silent empty charts.

**Numeric coercion (typed accessor, exported from this module):** cells are kept as raw strings; `numAt(row, col)`
coerces a named column with `Number()` and throws **only** when the result is `NaN` (a genuine parse failure).
A parsed `0` / `0.0` is valid data and renders a zero/near-zero bar — "no silent empty chart" means *missing
table* fails loudly, NOT that a legitimate zero value is rejected. Real near-zero values exist (e.g. 04c
`z_unparseable_or_null = 0.0`, 04a `G = 0.646`) and must render.

### 5.2 `charts.mjs`
Three pure SVG primitives, string-returning:
- `hbar(series, opts)` — horizontal bars (top-N categorical).
- `vbar(series, opts)` — vertical bars (ordered buckets).
- `line(series, opts)` — single line over an ordered x-axis (monthly time series).

Determinism + check-pii safety (both invariants, both tested):
- **Integer-only coordinates.** Every coordinate, length, and `viewBox` value emitted into SVG is a rounded
  integer. This serves determinism AND avoids check-pii's false-positive IPv4 match: a four-group dotted token
  like `12.3.4.5` would trip `check-pii.sh`'s `\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b`. Integer coordinates make any
  four-dotted-number token impossible by construction. `charts.mjs` asserts (and a test verifies) that its
  output contains no such token.
- **Fixed-radix number helper.** Numbers are formatted by an explicit helper that uses `String(n)` /
  fixed-radix only — never `toLocaleString`/`Intl`/locale separators. Data labels are emitted as raw integers
  (e.g. `48344`, not `48,344` or `48.3k`) so they are byte-stable and substring-assertable by scenarios.
- No random, no clock. Data labels are rendered as `<text>` nodes so they are assertable.

### 5.3 `compose-html.mjs`
Assembles the full HTML string: document head linking `theme.css` (inlined for a self-contained file), then per
report — narrative block (from `narrative.es.md`), charts (from `charts.mjs`), backing tables (from parsed
data). Branch codes are relabeled through `branch-labels.json` when a code is present, else shown raw.

### 5.4 `theme.css`
Print CSS: `@page { size: A4; margin: ... }`, brand palette + typography, table styling, chart sizing,
page-break control (`break-inside: avoid` for report sections). Committed.

### 5.5 `narrative.es.md`
Executive narrative in Spanish, one block per report, delimited by stable anchors
(e.g. `<!-- NARRATIVE: 01 -->`). Authored, then run through **/humanizer** (mandatory — user-facing prose).
Committed. Static → deterministic. Committed text (here and in `branch-labels.json`) must not contain the raw
PII column tokens (`response_raw`, bare `source_ip`) — `check-pii.sh` greps for them literally.

### 5.6 `branch-labels.json`
Optional `{ "AABOT": "Bogotá", ... }` map. Populated with known codes; fallback to the raw code for any
unmapped code. Extensible without code changes.

### 5.7 `render-pdf.sh`
Orchestrator:
1. Assert canonical bundle exists.
2. Run `compose-html.mjs` → write `report.html` atomically (temp → move).
3. Run the existing `check-pii.sh` over `report.html` (defense in depth) — abort on any hit. The script lives one
   level up, so the orchestrator invokes it by explicit relative path: `"$SCRIPT_DIR/../check-pii.sh" "$html"`
   (no CWD/PATH dependency). `check-pii.sh` accepts arbitrary path args and treats non-`.sql` files as report
   surfaces. The integer-coordinate invariant (§5.2) is what keeps SVG from false-tripping its IPv4 regex;
   SCEN-005 proves the *real composed HTML* passes.
4. Resolve Chromium; `--headless --print-to-pdf=<out>` from `report.html`.
5. Validate output: starts with `%PDF`, non-empty. On failure, leave no partial PDF.
6. Print the PDF path.

## 6. Charts per report

| Report | Chart(s) | Source cut |
|---|---|---|
| 01 Demand | line: searches/month; hbar: top-10 branches | 01b, 01a |
| 02 Pricing | hbar: median price per category (top by n_quotes) | 02a |
| 03 Failure | hbar: error_code breakdown; hbar: pd_kind share | 03b, 03a |
| 04 Avail/Behavior | hbar: availability per category; vbar: lead-time + duration buckets; hbar: one-way vs round-trip | 04a, 04b, 04c, 04d |

Full tables render below each chart.

## 7. Determinism & PII

- **Determinism** is asserted at the HTML+SVG layer: `charts.mjs` and `compose-html.mjs` produce byte-identical
  output across two runs on the same input. The PDF binary is **excluded** from the determinism assert (Chromium
  embeds creation timestamps) — same exclusion principle as Phase 3.5's run-date line in SCEN-007.
- **PII:** the input bundle is already PII-free (Phase 3.5 SCEN-005). `check-pii.sh` additionally runs over the
  generated HTML as a gate. The integer-coordinate invariant (§5.2) prevents SVG path/coordinate data from
  false-tripping its IPv4 regex; SCEN-005 proves the real composed HTML (charts included) passes.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Canonical bundle missing | `render-pdf.sh` aborts with a clear message |
| Expected cut absent in bundle | `parse-bundle.mjs` throws naming the cut |
| Non-numeric value where a number is required | typed accessor throws (no zero-bar) |
| `check-pii` hit on HTML | abort before Chromium; no PDF |
| Chromium non-zero exit / empty / non-`%PDF` output | abort; no partial PDF left |

## 9. File structure

```
scripts/analysis/log-veh/pdf/
  parse-bundle.mjs      # markdown bundle → structured data (pure); exports the numAt typed accessor
  charts.mjs            # hbar / vbar / line → SVG string (pure); owns the fixed-radix number-format helper
  compose-html.mjs      # data + narrative + charts + css → HTML string (pure)
  theme.css             # branded print CSS (committed)
  narrative.es.md       # Spanish executive narrative (committed, humanized)
  branch-labels.json    # optional code→display map (committed)
  render-pdf.sh         # orchestrator → report.html (gitignored) → PDF (gitignored)
  README.md             # how to regenerate
tests/unit/analysis/log-veh-pdf/
  parse-bundle.test.ts  # parser fidelity + missing-cut guard
  charts.test.ts        # SVG determinism + numeric labels
.gitignore += scripts/analysis/log-veh/pdf/report.html, scripts/analysis/log-veh/pdf/*.pdf
```

## 10. Testing strategy

- **Unit (vitest):** `parse-bundle` fidelity (anchors equal the canonical bundle), missing-cut guard throws;
  `charts` determinism (byte-identical SVG) and numeric labels equal source values.
- **End-to-end (script):** `render-pdf.sh` produces a `%PDF` non-empty file; HTML passes `check-pii`; HTML+SVG
  byte-identical across two runs; narrative sentinel phrases present; `git check-ignore` confirms PDF + HTML
  ignored.

## 11. Observable scenarios (holdout for SDD)

1. **PDF produced** — run render-pdf → `%PDF`-headed non-empty PDF + intermediate HTML exist.
2. **Parser fidelity** — `parse-bundle` extracts 01a `AABOT=63258` (and other anchors) exactly.
3. **Determinism** — `charts.mjs` + `compose-html` byte-identical across two runs.
4. **Missing-cut guard** — bundle with a removed expected table → `parse-bundle` throws a clear error.
5. **PII-free** — the real composed `report.html` (charts + tables + narrative) passes `check-pii.sh` (exit 0),
   proving the integer-coordinate invariant keeps SVG from false-tripping the IPv4 regex.
6. **Spanish narrative present** — each report section in the HTML contains its narrative sentinel phrase.
7. **PDF gitignored** — `git check-ignore` confirms `*.pdf` and `report.html` ignored.
8. **Numeric labels = bundle** — R01 line emits a raw-integer `<text>` label `48344` for `2025-12` (the helper
   adds no separators, so the literal substring is assertable and equals the bundle value).

## 12. Alternatives considered

- **Charts via JS library + Playwright `page.pdf()`** — rejected: dependency + JS-render wait race
  (non-deterministic).
- **Markdown-first renderer** — rejected: markdown fights branded layout + narrative + charts.
- **Committed PDF binary** — rejected: breaks byte-determinism, noisy diffs, can go stale vs markdown.
- **Re-query DuckDB/Parquet for PDF data** — rejected: reintroduces Parquet dependency and drift risk vs the
  canonical bundle.

## 13. Future work

- Extend `branch-labels.json` to a complete code→name map (sourced from the locations table).
- Optional cover page / table of contents if the report set grows.
