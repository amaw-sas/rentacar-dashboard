// compose-markdown.mjs — PURE composer for a presentable Markdown variant of the
// issue #45 log_veh report. Same data + narrative + period + branch relabeling as the
// HTML/PDF, rendered as GitHub-flavored Markdown. No charts (Markdown can't embed SVG).
//
// composeMarkdown({ bundleMd, narrativeMd, branchLabels }) -> string
//
// Purity contract: identical inputs -> byte-identical output.
//   - NO fs, NO new Date(), NO Math.random(), NO Intl/toLocaleString.
//   - Helpers are duplicated from compose-html.mjs on purpose: this module stays
//     self-contained and the merged HTML composer is left untouched (zero blast radius).

import { parseBundle } from "./parse-bundle.mjs";

const REPORT_ORDER = ["01", "02", "03", "04", "05"];

// Fixed cut manifest per report — drives deterministic table ordering.
const REPORT_CUTS = {
  "01": ["01a", "01b", "01c", "01d"],
  "02": ["02a", "02b", "02c"],
  "03": ["03a", "03b", "03c", "03d"],
  "04": ["04a", "04b", "04c", "04d", "04e"],
  "05": ["05a", "05b", "05c", "05d", "05e", "05f"],
};

// Columns whose cells hold a branch code that must be relabeled.
const BRANCH_COLUMNS = new Set(["pickup_location", "return_location"]);

// Numeric columns render right-aligned. Anything not here is treated as text.
const TEXT_COLUMNS = new Set([
  "pickup_location",
  "return_location",
  "month_utc",
  "category_code",
  "category_description",
  "pd_kind",
  "error_code",
  "bucket",
  "trip_type",
  "lead_bucket",
  "dur_band",
  "pickup_week",
  "low_confidence",
  "sweet_spot_bucket",
]);

// Spanish month names — fixed array (no Intl/toLocaleString) to keep output deterministic.
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// "2024-05" -> "mayo 2024".
function formatMonthEs(ym) {
  const [y, m] = String(ym).split("-");
  return `${MONTHS_ES[Number(m) - 1] ?? ym} ${y}`;
}

// Analyzed data period from cut 01b (month_utc min/max). "" when 01b is absent.
function analyzedPeriod(bundle) {
  const months = (bundle?.["01"]?.["01b"]?.rows ?? [])
    .map((r) => r.month_utc)
    .filter(Boolean)
    .sort();
  if (months.length === 0) return "";
  const from = formatMonthEs(months[0]);
  const to = formatMonthEs(months[months.length - 1]);
  return from === to ? from : `${from} – ${to}`;
}

function relabel(code, branchLabels) {
  return branchLabels[code] ?? code;
}

// Escape a value for a GFM table cell: pipes break columns, newlines break rows.
function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Extract each cut's human description straight from the bundle markers
// (`--- 01a: top pickup branches (denominator: ...) ---`). Accurate captions
// sourced from the canonical bundle — never invented. Returns { "01a": "...", ... }.
function extractCutDescriptions(bundleMd) {
  const out = {};
  const re = /---\s*(\d+[a-z]):\s*(.+?)\s*---/g;
  let m;
  while ((m = re.exec(bundleMd)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

// Parse narrative.es.md into { "01": { heading, body } } where body is plain
// Markdown paragraphs (the source file is already Markdown — pass it through).
function parseNarrative(narrativeMd) {
  const out = {};
  const blocks = narrativeMd.split(/<!--\s*NARRATIVE:\s*(\d{2})\s*-->/);
  // [pre, "01", body01, "02", body02, ...]
  for (let i = 1; i < blocks.length; i += 2) {
    const id = blocks[i];
    const raw = blocks[i + 1] ?? "";
    const lines = raw.split(/\r?\n/);
    let heading = "";
    const bodyLines = [];
    for (const ln of lines) {
      if (heading === "" && /^##\s+/.test(ln.trim())) {
        heading = ln.trim().replace(/^##\s+/, "").trim();
        continue;
      }
      if (heading !== "") bodyLines.push(ln);
    }
    const body = bodyLines
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim().replace(/\n/g, " "))
      .filter((p) => p.length > 0)
      .join("\n\n");
    out[id] = { heading, body };
  }
  return out;
}

// Render one cut as a GFM table. Relabels branch-code cells; right-aligns numerics.
function mdTable(cut, branchLabels) {
  const cols = cut.columns;
  const header = `| ${cols.map(cell).join(" | ")} |`;
  const delim = `| ${cols.map((c) => (TEXT_COLUMNS.has(c) ? "---" : "---:")).join(" | ")} |`;
  const body = cut.rows
    .map((row) => {
      const cells = cols.map((c) => {
        const raw = row[c] ?? "";
        return cell(BRANCH_COLUMNS.has(c) ? relabel(raw, branchLabels) : raw);
      });
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
  return `${header}\n${delim}\n${body}`;
}

/**
 * Compose the presentable Markdown report.
 * @param {Object} args
 * @param {string} args.bundleMd      DuckDB -markdown report bundle.
 * @param {string} args.narrativeMd   narrative.es.md contents.
 * @param {Object} args.branchLabels  { code: humanLabel }.
 * @returns {string} Markdown document.
 */
export function composeMarkdown({ bundleMd, narrativeMd, branchLabels }) {
  const bundle = parseBundle(bundleMd);
  const narrative = parseNarrative(narrativeMd);
  const labels = branchLabels ?? {};
  const descriptions = extractCutDescriptions(bundleMd);
  const period = analyzedPeriod(bundle);

  const parts = [
    `# Reporte de búsquedas y disponibilidad`,
    ``,
    `_Análisis de demanda, precios, cotización y disponibilidad_`,
  ];
  if (period) {
    parts.push(``, `**Periodo analizado:** ${period}`);
  }
  parts.push(
    ``,
    `> Generado a partir del bundle canónico log_veh (Fase 3.5). Cifras reconciliadas, sin PII.`,
  );

  for (const report of REPORT_ORDER) {
    const n = narrative[report] ?? { heading: "", body: "" };
    const cuts = bundle[report] ?? {};

    if (n.heading) parts.push(``, `## ${n.heading}`);
    if (n.body) parts.push(``, n.body);

    for (const id of REPORT_CUTS[report]) {
      const cut = cuts[id];
      if (!cut) continue;
      const desc = descriptions[id] ? `${id} — ${descriptions[id]}` : id;
      parts.push(``, `#### ${desc}`, ``, mdTable(cut, labels));
    }
  }

  parts.push(``);
  return parts.join("\n");
}
