---
name: pdf-period
created_by: claude-opus-4.8-via-sdd
created_at: 2026-06-10T00:00:00Z
spec: docs/specs/2026-06-09-issue-45-pdf-reports-design.md
issue: 45
phase: pdf-period
---

# Scenario — analyzed-data period in the PDF report header

Follow-up to the merged log_veh PDF report (PR #117). A management report must state the time span of
the data it analyzes; the period was only inferable from the line chart's x-axis, never stated. This adds
an explicit period line to the report header, **derived from the canonical bundle** (cut 01b `month_utc`
min/max) — no new data source, no re-query. Pure transformation, same invariants as the parent feature
(determinism, PII-free, no Intl/locale formatting — Spanish month names come from a fixed in-code array).

Anchor from the committed bundle: cut 01b `month_utc` ranges from `2024-05` to `2026-05` (25 months).

---

## SCEN-009: report header states the analyzed data period

**Given**: the real committed bundle (cut 01b `month_utc` spans `2024-05` … `2026-05`).
**When**: `composeHtml(...)` renders the document.
**Then**: the header contains an explicit period line that names both the start and end month of the data —
`mayo 2024` and `mayo 2026` — labelled as the analyzed period (e.g. "Periodo analizado: mayo 2024 – mayo
2026"). The months are formatted from a fixed Spanish month-name array (no `toLocaleString`/`Intl`), so the
output stays byte-deterministic.
**Evidence**: the composed `report.html` contains the substring `mayo 2024` and the substring `mayo 2026`
within a period label; `composeHtml` remains byte-identical across two runs (parent SCEN-003 still holds).
