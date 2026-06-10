// charts.mjs — pure ESM SVG chart primitives for the issue #45 PDF report bundle.
//
// Design contract (do not deviate — compose-html depends on these signatures):
//   hbar(series, opts) -> string   horizontal bars, top-N categorical; value label at bar end
//   vbar(series, opts) -> string   vertical bars, ordered buckets; value label above bar
//   line(series, opts) -> string   single line over ordered x; circle markers + value label/point
//   fmtInt(n) -> string            fixed-radix integer formatting: String(Math.round(n))
//
// Invariants (SCEN-003 / SCEN-005 / SCEN-008):
//   - INTEGER-ONLY geometry. Every numeric token emitted into the SVG is Math.round'd.
//     This guarantees byte-determinism AND makes a four-group dotted IPv4-shaped token
//     (/[0-9]{1,3}(\.[0-9]{1,3}){3}/) impossible by construction.
//   - Value labels render the raw rounded integer via fmtInt — NO toLocaleString, NO Intl,
//     NO thousands separators, NO k-abbreviation. 48344 stays "48344".
//   - Pure: identical input -> byte-identical output. No Date, no Math.random, no locale.
//     Input arrays are iterated in order (no Map iteration surprises).

/** Fixed-radix integer formatting. NEVER locale/Intl/separators. */
export function fmtInt(n) {
  return String(Math.round(Number(n)));
}

/** Integer coordinate helper — single choke point for the integer-only invariant. */
function px(n) {
  return Math.round(Number(n));
}

/** XML-escape for category/x label text (data has none of these, but be safe). */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Defense-in-depth: refuse to emit anything resembling a dotted IPv4 quad. */
const DOTTED_QUAD = /[0-9]{1,3}(\.[0-9]{1,3}){3}/;
function guard(svg) {
  if (DOTTED_QUAD.test(svg)) {
    throw new Error("charts: emitted SVG contains a four-group dotted token (IPv4-shaped)");
  }
  return svg;
}

/** Max of an array of values, floored at 1 so we never divide by zero. */
function maxValue(values) {
  let m = 0;
  for (const v of values) {
    const n = Number(v);
    if (n > m) m = n;
  }
  return m > 0 ? m : 1;
}

/**
 * Horizontal bars. series: [{ label, value }].
 * opts: { width, height, title?, color? }.
 */
export function hbar(series, opts = {}) {
  const items = Array.isArray(series) ? series : [];
  const width = px(opts.width ?? 800);
  const height = px(opts.height ?? Math.max(120, 40 + items.length * 32));
  const color = esc(opts.color ?? "#2563eb");
  const title = opts.title;

  const padL = px(180); // room for category labels
  const padR = px(80); // room for value labels at bar end
  const padT = px(title ? 40 : 16);
  const padB = px(16);
  const plotW = px(width - padL - padR);
  const plotH = px(height - padT - padB);
  const rowH = px(items.length > 0 ? plotH / items.length : plotH);
  const barH = px(rowH * 0.62);
  const max = maxValue(items.map((d) => d.value));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">`);
  if (title) {
    parts.push(`<text x="${px(padL)}" y="${px(24)}" font-size="16" font-weight="bold" fill="#111827">${esc(title)}</text>`);
  }
  // baseline axis
  parts.push(`<line x1="${padL}" y1="${px(padT)}" x2="${padL}" y2="${px(padT + plotH)}" stroke="#9ca3af" stroke-width="1"/>`);

  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    const value = Number(d.value);
    // Clamp at 0: a negative value must not emit an invalid negative SVG width.
    const barW = px(Math.max(0, (value / max) * plotW));
    const rowTop = px(padT + i * rowH);
    const barY = px(rowTop + (rowH - barH) / 2);
    const textY = px(barY + barH / 2 + 4);
    parts.push(`<text x="${px(padL - 8)}" y="${textY}" font-size="12" text-anchor="end" fill="#374151">${esc(d.label)}</text>`);
    parts.push(`<rect x="${padL}" y="${barY}" width="${barW}" height="${barH}" fill="${color}"/>`);
    parts.push(`<text x="${px(padL + barW + 6)}" y="${textY}" font-size="12" text-anchor="start" fill="#111827">${fmtInt(value)}</text>`);
  }

  parts.push(`</svg>`);
  return guard(parts.join(""));
}

/**
 * Vertical bars. series: [{ label, value }] in display order.
 * opts: { width, height, title?, color? }.
 */
export function vbar(series, opts = {}) {
  const items = Array.isArray(series) ? series : [];
  const width = px(opts.width ?? 800);
  const height = px(opts.height ?? 320);
  const color = esc(opts.color ?? "#2563eb");
  const title = opts.title;

  const padL = px(48);
  const padR = px(24);
  const padT = px(title ? 48 : 28); // top room for value labels above bars
  const padB = px(56); // bottom room for category labels
  const plotW = px(width - padL - padR);
  const plotH = px(height - padT - padB);
  const colW = px(items.length > 0 ? plotW / items.length : plotW);
  const barW = px(colW * 0.62);
  const baseY = px(padT + plotH);
  const max = maxValue(items.map((d) => d.value));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">`);
  if (title) {
    parts.push(`<text x="${padL}" y="${px(24)}" font-size="16" font-weight="bold" fill="#111827">${esc(title)}</text>`);
  }
  // baseline axis
  parts.push(`<line x1="${padL}" y1="${baseY}" x2="${px(padL + plotW)}" y2="${baseY}" stroke="#9ca3af" stroke-width="1"/>`);

  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    const value = Number(d.value);
    // Clamp at 0: a negative value must not emit an invalid negative SVG height.
    const barH = px(Math.max(0, (value / max) * plotH));
    const colLeft = px(padL + i * colW);
    const barX = px(colLeft + (colW - barW) / 2);
    const barY = px(baseY - barH);
    const cx = px(barX + barW / 2);
    parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="${color}"/>`);
    parts.push(`<text x="${cx}" y="${px(barY - 6)}" font-size="12" text-anchor="middle" fill="#111827">${fmtInt(value)}</text>`);
    parts.push(`<text x="${cx}" y="${px(baseY + 18)}" font-size="11" text-anchor="middle" fill="#374151">${esc(d.label)}</text>`);
  }

  parts.push(`</svg>`);
  return guard(parts.join(""));
}

/**
 * Single line over ordered x. series: [{ x, y }] in display order.
 * opts: { width, height, title?, color? }.
 */
export function line(series, opts = {}) {
  const items = Array.isArray(series) ? series : [];
  const width = px(opts.width ?? 800);
  const height = px(opts.height ?? 300);
  const color = esc(opts.color ?? "#2563eb");
  const title = opts.title;

  const padL = px(48);
  const padR = px(48);
  const padT = px(title ? 48 : 28); // top room for the value label above markers
  const padB = px(48); // bottom room for x labels
  const plotW = px(width - padL - padR);
  const plotH = px(height - padT - padB);
  const baseY = px(padT + plotH);
  const max = maxValue(items.map((d) => d.y));
  const n = items.length;
  const step = px(n > 1 ? plotW / (n - 1) : 0);

  // Precompute integer marker coordinates.
  const pts = [];
  for (let i = 0; i < n; i++) {
    const value = Number(items[i].y);
    const cx = px(n > 1 ? padL + i * step : padL + plotW / 2);
    // Clamp at 0: a negative value sits on the baseline rather than off-canvas.
    const cy = px(baseY - (Math.max(0, value) / max) * plotH);
    pts.push({ cx, cy, value, x: items[i].x });
  }

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">`);
  if (title) {
    parts.push(`<text x="${padL}" y="${px(24)}" font-size="16" font-weight="bold" fill="#111827">${esc(title)}</text>`);
  }
  // baseline axis
  parts.push(`<line x1="${padL}" y1="${baseY}" x2="${px(padL + plotW)}" y2="${baseY}" stroke="#9ca3af" stroke-width="1"/>`);

  // polyline of all markers
  if (pts.length > 0) {
    const poly = pts.map((p) => `${p.cx},${p.cy}`).join(" ");
    parts.push(`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2"/>`);
  }

  // markers + value label + x tick label
  for (const p of pts) {
    parts.push(`<circle cx="${p.cx}" cy="${p.cy}" r="3" fill="${color}"/>`);
    parts.push(`<text x="${p.cx}" y="${px(p.cy - 8)}" font-size="12" text-anchor="middle" fill="#111827">${fmtInt(p.value)}</text>`);
    parts.push(`<text x="${p.cx}" y="${px(baseY + 18)}" font-size="11" text-anchor="middle" fill="#374151">${esc(p.x)}</text>`);
  }

  parts.push(`</svg>`);
  return guard(parts.join(""));
}
