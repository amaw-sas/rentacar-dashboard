// Pure ESM parser for the DuckDB `-markdown` log_veh report bundle (issue #45).
// No deps, no I/O. Given the bundle markdown string, returns nested cuts of raw-string rows.

// The 19 (report, cut) pairs that MUST all be present and non-empty.
const MANIFEST = [
  ["01", "01a"], ["01", "01b"], ["01", "01c"], ["01", "01d"],
  ["02", "02a"], ["02", "02b"], ["02", "02c"],
  ["03", "03a"], ["03", "03b"], ["03", "03c"], ["03", "03d"],
  ["04", "04a"], ["04", "04b"], ["04", "04c"], ["04", "04d"], ["04", "04e"],
];

const REPORT_MARKER = /^=== REPORT (\d+):/;
const CUT_MARKER = /^--- (\d+[a-z]):/;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Parse the DuckDB -markdown report bundle.
 * @param {string} markdownString
 * @returns {Object} { "01": { "01a": { columns: string[], rows: Object[] }, ... }, ... }
 */
export function parseBundle(markdownString) {
  const out = {};
  let currentReport = null;
  let currentCut = null;
  let expectingHeader = false;
  let currentColumns = null;

  const lines = markdownString.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Only table rows (start and end with `|`) are meaningful; skip everything else.
    if (!line.startsWith("|") || !line.endsWith("|")) continue;

    // Unwrap: split on `|`, drop the empty first/last segment, trim + collapse whitespace.
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/\s+/g, " "));

    // Single-cell rows MAY be markers / synthetic labels, OR a legitimate
    // single-column table (e.g. 01d reconciliation `total_rows`).
    if (cells.length === 1) {
      const cell = cells[0];

      const reportMatch = cell.match(REPORT_MARKER);
      if (reportMatch) {
        currentReport = reportMatch[1].padStart(2, "0");
        continue;
      }

      const cutMatch = cell.match(CUT_MARKER);
      if (cutMatch) {
        currentCut = cutMatch[1];
        expectingHeader = true;
        currentColumns = null;
        continue;
      }

      if (cell === "section" || cell === "subsection") continue;

      // Otherwise fall through: a single-cell separator is dropped below,
      // anything else is a single-column data row for the current cut.
    }

    // Separator rows: every cell is dashes (optionally colon-aligned).
    if (cells.every((c) => SEPARATOR_CELL.test(c))) continue;

    // Data rows belong to the current (report, cut).
    if (currentReport == null || currentCut == null) continue;

    if (expectingHeader) {
      currentColumns = cells;
      if (!out[currentReport]) out[currentReport] = {};
      out[currentReport][currentCut] = { columns: cells, rows: [] };
      expectingHeader = false;
      continue;
    }

    // Value row: zip columns -> cells.
    const cut = out[currentReport][currentCut];
    const row = {};
    for (let i = 0; i < currentColumns.length; i++) {
      row[currentColumns[i]] = cells[i];
    }
    cut.rows.push(row);
  }

  // Assert manifest completeness.
  for (const [report, cut] of MANIFEST) {
    const table = out[report] && out[report][cut];
    if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
      throw new Error(
        `parseBundle: missing or empty expected cut "${cut}" (report ${report}); ` +
          `every cut in the manifest must be present and non-empty`,
      );
    }
  }

  return out;
}

/**
 * Coerce a raw-string cell to a number. Legitimate 0 / 0.0 returns that number;
 * an empty/blank cell or a genuine NaN throws (so a NULL metric fails loud
 * instead of silently rendering a zero bar — Number("") is 0, not NaN).
 */
export function numAt(row, colName) {
  const raw = row[colName];
  if (raw == null || String(raw).trim() === "") {
    throw new Error(`numAt: column "${colName}" is empty/blank`);
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`numAt: column "${colName}" value "${raw}" is not a number`);
  }
  return n;
}
