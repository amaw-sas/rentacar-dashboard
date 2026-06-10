---
name: pdf-markdown
created_by: claude-opus-4.8-via-sdd
created_at: 2026-06-10T00:00:00Z
spec: docs/specs/2026-06-09-issue-45-pdf-reports-design.md
issue: 45
phase: pdf-markdown
---

# Scenario — presentable Markdown variant of the log_veh report

Follow-up to the merged PDF report (PR #117/#118). The canonical bundle is raw DuckDB tables (branch
codes, no narrative). This adds a **presentable Markdown** rendering — the same Spanish executive narrative,
the analyzed period, and the backing tables with branch codes relabeled to cities — for readers who want the
report in Markdown rather than PDF. No charts (Markdown cannot embed the SVG).

Pure transformation of the canonical bundle + the existing committed assets (`narrative.es.md`,
`branch-labels.json`). Same invariants as the parent feature: deterministic, PII-free, no Intl/locale
formatting. The rendered Markdown is a gitignored, regenerable derived artifact; the canonical bundle stays
the single versioned source.

Anchors from the committed bundle: 01a `AABOT → Bogotá` with `63258`; cut 01b spans `2024-05`…`2026-05`.

---

## SCEN-010: composeMarkdown renders a presentable, deterministic Markdown report

**Given**: the real committed bundle, `narrative.es.md`, and `branch-labels.json`.
**When**: `composeMarkdown({ bundleMd, narrativeMd, branchLabels })` runs.
**Then**: the output is valid Markdown that contains, in order, a top-level `# ` title; the analyzed period
line naming `mayo 2024` and `mayo 2026`; each of the 4 Spanish narrative headings verbatim
(`Demanda por sucursal y mes`, `Precios por gama`, `Cotizaciones fallidas`,
`Disponibilidad y comportamiento de reserva`); branch codes relabeled (`Bogotá`, not `AABOT`); the data
value `63258`; and GitHub-flavored Markdown tables (a header row followed by a `---` delimiter row). The
output is byte-identical across two runs on the same inputs.
**Evidence**: the composed `report.md` contains `# `, `mayo 2024`, `mayo 2026`, the 4 headings, `Bogotá`,
`63258`, and a `| --- |`-style delimiter row; a second `composeMarkdown` call returns an identical string;
`check-pii.sh report.md` exits 0.
