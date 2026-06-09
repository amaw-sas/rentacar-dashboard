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
State machine over the bundle's **stable markers**:
- section marker row: `=== REPORT NN: ... ===`
- subsection marker row: `--- NNx: ... ---`
- data rows: standard markdown pipe tables.

Walks the document, tracks current `(report, cut)` from the latest marker, and attaches each following pipe
table to that cut. Output: `{ "01": { "01a": { columns: [...], rows: [[...]] }, ... }, ... }`.

**Fail loud:** if any expected `(report, cut)` listed in an explicit manifest is absent, throw a clear error
naming the missing cut. No silent empty charts. The manifest of required cuts is a constant in the module.

Numeric parsing: cells are kept as raw strings; a typed accessor coerces a named column to Number and throws
on `NaN` (so a malformed table fails loudly, never renders a zero bar).

### 5.2 `charts.mjs`
Three pure SVG primitives, string-returning:
- `hbar(series, opts)` — horizontal bars (top-N categorical).
- `vbar(series, opts)` — vertical bars (ordered buckets).
- `line(series, opts)` — single line over an ordered x-axis (monthly time series).

Determinism: fixed viewBox, integer/rounded coordinates, no random, no clock, no locale-dependent formatting
(numbers formatted by an explicit helper). Data labels are rendered as `<text>` nodes so they are assertable.

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
Committed. Static → deterministic.

### 5.6 `branch-labels.json`
Optional `{ "AABOT": "Bogotá", ... }` map. Populated with known codes; fallback to the raw code for any
unmapped code. Extensible without code changes.

### 5.7 `render-pdf.sh`
Orchestrator:
1. Assert canonical bundle exists.
2. Run `compose-html.mjs` → write `report.html` atomically (temp → move).
3. Run `check-pii` over `report.html` (defense in depth) — abort on any hit.
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
- **PII:** the input bundle is already PII-free (Phase 3.5 SCEN-005). `check-pii` additionally runs over the
  generated HTML as a gate.

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
  parse-bundle.mjs      # markdown bundle → structured data (pure)
  charts.mjs            # hbar / vbar / line → SVG string (pure)
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
5. **PII-free** — generated HTML passes `check-pii` (exit 0).
6. **Spanish narrative present** — each report section in the HTML contains its narrative sentinel phrase.
7. **PDF gitignored** — `git check-ignore` confirms `*.pdf` and `report.html` ignored.
8. **Numeric labels = bundle** — R01 line labels `2025-12 = 48344` (equals the bundle).

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
