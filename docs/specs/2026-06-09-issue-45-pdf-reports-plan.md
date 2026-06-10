# Implementation Plan — log_veh PDF reports (issue #45)

**Date:** 2026-06-09
**Spec:** `docs/specs/2026-06-09-issue-45-pdf-reports-design.md` (approved)
**Holdout:** `docs/specs/2026-06-09-issue-45-pdf-reports/scenarios/pdf-reports.scenarios.md` (SCEN-001..008, write-once)
**Branch:** `task/issue-45-pdf-reports` (worktree `.worktrees/issue-45-pdf-reports`, from `main` b1d09de)

PR uses `Refs #45` — issue stays open for the price-prediction roadmap.

## Chunk 1: File structure + implementation steps

### Blast radius

**New files (all additive — zero changes to merged Phase 3.5 code):**
- `scripts/analysis/log-veh/pdf/parse-bundle.mjs`
- `scripts/analysis/log-veh/pdf/charts.mjs`
- `scripts/analysis/log-veh/pdf/compose-html.mjs`
- `scripts/analysis/log-veh/pdf/theme.css`
- `scripts/analysis/log-veh/pdf/narrative.es.md`
- `scripts/analysis/log-veh/pdf/branch-labels.json`
- `scripts/analysis/log-veh/pdf/render-pdf.sh`
- `scripts/analysis/log-veh/pdf/README.md`
- `tests/unit/analysis/log-veh-pdf/parse-bundle.test.ts`
- `tests/unit/analysis/log-veh-pdf/charts.test.ts`

**Modified files:**
- `.gitignore` — append `scripts/analysis/log-veh/pdf/report.html` and `scripts/analysis/log-veh/pdf/*.pdf`.

**Consumers:** none — this is an offline/ad-hoc generation step. No dashboard import, no `public.search_logs`,
no ETL coupling. The merged Phase 3.5 bundle is read-only input.

**Generated (gitignored, regenerable):** `report.html`, `log-veh-reports-<date>.pdf`.

### File responsibilities (single responsibility each)

| File | Responsibility | Purity |
|---|---|---|
| `parse-bundle.mjs` | DuckDB-markdown bundle → `{report}{cut}{columns,rows}`; missing-cut guard; exports `numAt` | pure (string in → object out) |
| `charts.mjs` | `hbar`/`vbar`/`line` → SVG string; owns fixed-radix number helper; integer-only coords | pure (data in → string out) |
| `compose-html.mjs` | parsed data + narrative + charts + css → full HTML string; relabels branch codes | pure (inputs in → string out) |
| `theme.css` | branded A4 print CSS, page-break control | static asset |
| `narrative.es.md` | Spanish executive narrative, one block per report, anchor-delimited | static asset (humanized) |
| `branch-labels.json` | optional code→display map, raw-code fallback | static data |
| `render-pdf.sh` | orchestrate: assert bundle → compose HTML (atomic) → check-pii → Chromium → validate `%PDF` | I/O orchestrator |
| `README.md` | how to regenerate | docs |
| `parse-bundle.test.ts` | parser fidelity to real bundle + missing-cut guard | test |
| `charts.test.ts` | SVG byte-determinism, no-four-dotted-token invariant, raw-integer labels | test |

The three pure modules carry the logic and are unit-tested in isolation; the shell orchestrator is validated
end-to-end. Files that change together (parser+its test, charts+its test) live together.

### Implementation steps

SDD throughout: each step defines its scenario(s) first, writes code, then converges until the holdout
scenario is satisfied. No test-only steps — tests are embedded in the functional step that introduces the
behavior. Sub-agents are opus only; review + validation agents run after each implementation step.

---

**Step 1 — Parser: bundle → structured data, with fidelity + missing-cut guard**
Size: M · Dependencies: none
- Scenario: *given the real committed bundle, `parse-bundle.mjs` yields 01a `AABOT.searches=63258` and 01b
  `2025-12.searches=48344` exactly, treats `=== REPORT ===`/`--- NNx ---` markers as cell-wrapped state
  transitions (not data), skips synthetic `section`/`subsection` label rows and all separator rows; a bundle
  missing an expected `(report,cut)` throws naming the cut.* (SCEN-002, SCEN-004)
- Build `parse-bundle.mjs`: per-row cell unwrap (trim `|`, collapse whitespace); marker regexes
  `^=== REPORT (\d+):` and `^--- (\d+[a-z]):`; skip `section`/`subsection`/separator (`|---|` and `---:`) rows;
  first data row after a cut = column header; export `numAt(row, col)` coercing with `Number()`, throwing only
  on `NaN` (legit `0`/`0.0` is valid — e.g. 04c `z_unparseable_or_null=0.0`, 04a `G=0.646` must parse).
  Manifest constant of expected `(report,cut)` pairs (01a–01d, 02a–02c, 03a–03d, 04a–04e) → fail loud on absent.
- Tests (`parse-bundle.test.ts`): assert anchors via `numAt`; assert no parsed data row matches `^=== REPORT`
  or `^--- \d`; assert legit zero parses; missing-cut copy (drop one table) → throws with cut id in message.
- Acceptance: `pnpm test tests/unit/analysis/log-veh-pdf/parse-bundle.test.ts` green against the real bundle.

**Step 2 — Charts: deterministic SVG primitives with safe, assertable labels**
Size: M · Dependencies: none (parallel with Step 1)
- Scenario: *`charts.mjs` emits byte-identical SVG across two runs on the same input; the R01 line chart for
  `2025-12` contains literal `>48344<` (raw integer, no separators/`k`); no emitted token matches
  `[0-9]{1,3}(\.[0-9]{1,3}){3}`.* (SCEN-003 charts half, SCEN-008, SCEN-005 invariant half)
- Build `charts.mjs`: `hbar`/`vbar`/`line`, integer-only coords/lengths/viewBox (round at emit); fixed-radix
  number helper using `String(n)` only — never `toLocaleString`/`Intl`; data labels as `<text>` raw integers;
  no clock/random; runtime assert that output contains no four-group dotted token.
- Tests (`charts.test.ts`): emit twice, `===` byte-equal; assert `>48344<` present and `48,344`/`48.3k` absent;
  assert no four-dotted-number token in output.
- Acceptance: `pnpm test tests/unit/analysis/log-veh-pdf/charts.test.ts` green.

**Step 3 — Committed assets: branch labels + Spanish narrative (humanized)**
Size: S · Dependencies: none
- Scenario: *each report block carries a stable Spanish sentinel phrase that survives into the composed HTML.*
  (feeds SCEN-006)
- `branch-labels.json`: known codes (e.g. `AABOT`→`Bogotá`) with raw-code fallback; no `response_raw`/`source_ip`
  literal.
- `narrative.es.md`: one block per report (R01–R04), anchor-delimited (`<!-- NARRATIVE: 01 -->` …), each with an
  assertable sentinel phrase. **Author then run through `/humanizer`** (mandatory — user-facing prose). No raw
  PII tokens.
- Acceptance: file present; 4 anchors + 4 sentinels; humanizer pass done; `check-pii.sh narrative.es.md` exit 0.

**Step 4 — Compose: branded HTML from data + charts + narrative + CSS**
Size: M · Dependencies: Steps 1, 2, 3
- Scenario: *`compose-html.mjs` produces byte-identical HTML across two runs; each report section contains its
  narrative sentinel; branch codes relabel via `branch-labels.json` (raw fallback).* (SCEN-003 compose half,
  SCEN-006)
- `theme.css`: `@page{size:A4;margin:…}`, brand palette/typography, table + chart sizing,
  `break-inside:avoid` per section.
- `compose-html.mjs`: inline `theme.css` (self-contained file); per report → narrative block + charts (§6 map:
  R01 line 01b + hbar 01a; R02 hbar 02a; R03 hbar 03b + hbar 03a; R04 hbar 04a + vbar 04b/04c + hbar 04d) +
  backing tables; pure (no clock/random).
- Tests: extend a compose check (or add to charts/parse test homes) asserting two-run byte-equality of the HTML
  string and presence of all 4 sentinels. (No re-query — operates on parsed data + static assets only.)
- Acceptance: compose determinism + sentinel assertions green.

**Step 5 — Orchestrator + gitignore: render-pdf.sh end-to-end**
Size: M · Dependencies: Step 4
- Scenario: *`render-pdf.sh` writes `report.html` then a non-empty `%PDF`-headed PDF and exits 0; the real
  composed HTML passes `check-pii.sh` (exit 0); `git check-ignore` confirms `report.html` and `*.pdf` ignored
  while the markdown bundle is not.* (SCEN-001, SCEN-005, SCEN-007)
- `render-pdf.sh`: assert bundle exists → compose HTML to temp then atomic move → run
  `"$SCRIPT_DIR/../check-pii.sh" "$html"` (abort on hit) → resolve Chromium (Playwright cache or system
  `chromium`/`chromium-browser`, mirroring `generate-reports.sh` duckdb resolution) → `--headless
  --print-to-pdf=<out>` → validate first bytes `%PDF` + non-empty, leave no partial on failure → print path.
- `.gitignore`: append `scripts/analysis/log-veh/pdf/report.html` and `scripts/analysis/log-veh/pdf/*.pdf`.
- Acceptance: run the script against the real bundle → `%PDF` non-empty PDF + `report.html` exist, exit 0;
  `check-pii.sh report.html` exit 0; `git check-ignore` matches both artifacts, misses the bundle.

**Step 6 — README + full-pipeline verification**
Size: S · Dependencies: Step 5
- `README.md`: how to regenerate (one command), inputs/outputs, that the PDF is a gitignored derived artifact and
  the markdown bundle is canonical.
- Run `/verification-before-completion`: fresh evidence for all 8 scenarios (full `pnpm test` for the two unit
  files, a clean `render-pdf.sh` run, the two-run determinism `cmp`, `check-pii.sh`, `git check-ignore`).
- Acceptance: all 8 holdout scenarios satisfied with fresh observable evidence; `pnpm lint` + `pnpm type-check`
  green for the new `.ts` tests.

### Testing strategy
- Unit (vitest, `tests/unit/analysis/log-veh-pdf/`): parser fidelity + missing-cut guard; charts determinism +
  raw-integer labels + no-four-dotted-token. `.ts` tests import the `.mjs` modules (Vite resolves ESM natively;
  `.mjs` is established in-repo).
- End-to-end (script): `render-pdf.sh` `%PDF` non-empty; HTML passes `check-pii.sh`; HTML+SVG byte-identical
  across two runs; narrative sentinels present; `git check-ignore` confirms ignore.
- Quality gate after implementation: 4-agent panel (code-reviewer, security-reviewer, edge-case-detector,
  performance-engineer) via `/pull-request`.

### Rollout
- No deploy surface (offline script). "Rollout" = merge the PR; regeneration is on-demand via `render-pdf.sh`.
- Rollback = revert the PR; nothing productive depends on it; no DB/Vercel state touched.
- Monitoring = N/A (no runtime). Determinism + check-pii are the standing guarantees.
