// compose-html.mjs — PURE composer for the issue #45 log_veh PDF report bundle.
//
// composeHtml({ bundleMd, narrativeMd, branchLabels, themeCss, reportDate }) -> string
//
// Purity contract (SCEN-003): identical inputs -> byte-identical output.
//   - NO fs, NO new Date(), NO Math.random(), NO Intl/toLocaleString.
//   - The only date in the document is the optional `reportDate` STRING the caller passes.
//   - Iteration order follows the bundle's row order and a fixed cut manifest.

import { numAt, parseBundle } from "./parse-bundle.mjs";
import { hbar, line, vbar } from "./charts.mjs";

// HTML-escape dynamic text cells (& < > and quotes for attribute safety).
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Columns whose cells hold a branch code that must be relabeled.
const BRANCH_COLUMNS = new Set(["pickup_location", "return_location"]);

// Numeric columns render right-aligned. Anything not in this set is treated as text.
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

// Fixed cut manifest per report — drives deterministic table ordering.
const REPORT_CUTS = {
  "01": ["01a", "01b", "01c", "01d"],
  "02": ["02a", "02b", "02c"],
  "03": ["03a", "03b", "03c", "03d"],
  "04": ["04a", "04b", "04c", "04d", "04e"],
  "05": ["05a", "05b", "05c", "05d", "05e", "05f"],
};

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

const REPORT_ORDER = ["01", "02", "03", "04", "05"];

function relabel(code, branchLabels) {
  return branchLabels[code] ?? code;
}

// Parse narrative.es.md into { "01": { heading, bodyHtml }, ... }.
// Each block starts at `<!-- NARRATIVE: NN -->`; the first `## ` line is the
// heading (sentinel), the rest become <p> paragraphs (blank line separated).
function parseNarrative(narrativeMd) {
  const out = {};
  const blocks = narrativeMd.split(/<!--\s*NARRATIVE:\s*(\d{2})\s*-->/);
  // split yields: [pre, "01", body01, "02", body02, ...]
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
    // Group body into paragraphs separated by blank lines.
    const paragraphs = bodyLines
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => `<p>${esc(p.replace(/\n/g, " "))}</p>`);
    out[id] = { heading, bodyHtml: paragraphs.join("\n") };
  }
  return out;
}

// Render one cut as an HTML table. Relabels branch-code cells in BRANCH_COLUMNS.
function renderTable(cutId, cut, branchLabels) {
  const cols = cut.columns;
  const thead = cols
    .map((c) => {
      const cls = TEXT_COLUMNS.has(c) ? "" : ' class="numeric"';
      return `<th${cls}>${esc(c)}</th>`;
    })
    .join("");
  const body = cut.rows
    .map((row) => {
      const tds = cols
        .map((c) => {
          const raw = row[c] ?? "";
          const value = BRANCH_COLUMNS.has(c) ? relabel(raw, branchLabels) : raw;
          const cls = TEXT_COLUMNS.has(c) ? "" : ' class="numeric"';
          return `<td${cls}>${esc(value)}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return (
    `<table>` +
    `<caption>${esc(cutId)}</caption>` +
    `<thead><tr>${thead}</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table>`
  );
}

// Top-N slice for chart input (full table still renders every row).
function topN(rows, n) {
  return rows.length > n ? rows.slice(0, n) : rows;
}

function wrapChart(svg) {
  return `<div class="chart">${svg}</div>`;
}

// Build the chart SVG list for a given report from its parsed cuts.
function chartsFor(report, cuts, branchLabels) {
  const out = [];
  if (report === "01") {
    const b = cuts["01b"];
    out.push(
      line(
        b.rows.map((r) => ({ x: r.month_utc, y: numAt(r, "searches") })),
        { title: "Búsquedas por mes", color: "#2563eb" },
      ),
    );
    const a = topN(cuts["01a"].rows, 10);
    out.push(
      hbar(
        a.map((r) => ({ label: relabel(r.pickup_location, branchLabels), value: numAt(r, "searches") })),
        { title: "Top sucursales por búsquedas", color: "#2563eb" },
      ),
    );
  } else if (report === "02") {
    const a = topN(cuts["02a"].rows, 10);
    out.push(
      hbar(
        a.map((r) => ({ label: r.category_description, value: numAt(r, "median_total_amount") })),
        { title: "Mediana de cotización por gama", color: "#7c3aed" },
      ),
    );
  } else if (report === "03") {
    out.push(
      hbar(
        cuts["03b"].rows.map((r) => ({ label: r.error_code, value: numAt(r, "rows_n") })),
        { title: "Errores por código", color: "#dc2626" },
      ),
    );
    out.push(
      hbar(
        cuts["03a"].rows.map((r) => ({ label: r.pd_kind, value: numAt(r, "rows_n") })),
        { title: "Resultado de la cotización", color: "#dc2626" },
      ),
    );
  } else if (report === "04") {
    out.push(
      hbar(
        cuts["04a"].rows.map((r) => ({ label: r.category_description, value: numAt(r, "availability_rate_pct") })),
        { title: "Disponibilidad por gama (%)", color: "#059669" },
      ),
    );
    out.push(
      vbar(
        cuts["04b"].rows.map((r) => ({ label: r.bucket, value: numAt(r, "searches") })),
        { title: "Anticipación (lead-time)", color: "#059669" },
      ),
    );
    out.push(
      vbar(
        cuts["04c"].rows.map((r) => ({ label: r.bucket, value: numAt(r, "searches") })),
        { title: "Duración del alquiler", color: "#059669" },
      ),
    );
    out.push(
      hbar(
        cuts["04d"].rows.map((r) => ({ label: r.trip_type, value: numAt(r, "searches") })),
        { title: "Ida y vuelta vs. una vía", color: "#059669" },
      ),
    );
  } else if (report === "05") {
    // The curve: 05a is stored ascending (00_0d…09_90plus). Reverse to far→near so the
    // x-axis reads "book early → book last-minute" left→right. y = integer index_100
    // (the per-day price index, base 100 at the cheapest confident bucket).
    const curve = cuts["05a"].rows.slice().reverse();
    out.push(
      line(
        curve.map((r) => ({ x: r.lead_bucket, y: numAt(r, "index_100") })),
        { title: "Curva de anticipación (precio/día, base 100)", color: "#b45309" },
      ),
    );
    out.push(
      hbar(
        cuts["05d"].rows.map((r) => ({ label: r.category_description, value: numAt(r, "pct_increase_at_3d") })),
        { title: "Sobreprecio por día a 3 días vista, por gama (%)", color: "#b45309" },
      ),
    );
  }
  return out.map(wrapChart).join("\n");
}

/**
 * Compose the self-contained report HTML document.
 * @param {Object} args
 * @param {string} args.bundleMd      DuckDB -markdown report bundle.
 * @param {string} args.narrativeMd   narrative.es.md contents.
 * @param {Object} args.branchLabels  { code: humanLabel }.
 * @param {string} args.themeCss      theme.css contents (inlined).
 * @param {string} [args.reportDate]  optional date string for the footer.
 * @returns {string} full HTML document.
 */
export function composeHtml({ bundleMd, narrativeMd, branchLabels, themeCss, reportDate }) {
  const bundle = parseBundle(bundleMd);
  const narrative = parseNarrative(narrativeMd);
  const labels = branchLabels ?? {};
  const period = analyzedPeriod(bundle);

  const sections = REPORT_ORDER.map((report) => {
    const n = narrative[report] ?? { heading: "", bodyHtml: "" };
    const cuts = bundle[report] ?? {};
    const cutIds = REPORT_CUTS[report];

    const chartsHtml = chartsFor(report, cuts, labels);
    const tablesHtml = cutIds
      .filter((id) => cuts[id])
      .map((id) => renderTable(id, cuts[id], labels))
      .join("\n");

    return (
      `<section>` +
      `<h2>${esc(n.heading)}</h2>` +
      `<div class="narrative-body">${n.bodyHtml}</div>` +
      `<div class="charts">${chartsHtml}</div>` +
      `<div class="tables">${tablesHtml}</div>` +
      `</section>`
    );
  }).join("\n");

  const footer = reportDate
    ? `<footer class="report-footer">Datos al ${esc(reportDate)}</footer>`
    : "";

  return (
    `<!doctype html>` +
    `<html lang="es">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<title>Reporte log_veh</title>` +
    `<style>${themeCss}</style>` +
    `</head>` +
    `<body>` +
    `<header class="report-cover">` +
    `<h1>Reporte de búsquedas y disponibilidad</h1>` +
    `<div class="subtitle">Análisis de demanda, precios, cotización y disponibilidad</div>` +
    (period ? `<div class="period">Periodo analizado: ${esc(period)}</div>` : "") +
    `</header>` +
    sections +
    footer +
    `</body>` +
    `</html>`
  );
}
