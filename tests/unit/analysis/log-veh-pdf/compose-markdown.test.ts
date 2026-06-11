import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// compose-markdown.mjs is pure ESM without type declarations; allowJs infers it as untyped.
import { composeMarkdown } from "../../../../scripts/analysis/log-veh/pdf/compose-markdown.mjs";

const PDF_DIR = path.resolve(process.cwd(), "scripts/analysis/log-veh/pdf");
const BUNDLE_PATH = path.resolve(
  process.cwd(),
  "docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md",
);

const bundleMd = fs.readFileSync(BUNDLE_PATH, "utf8");
const narrativeMd = fs.readFileSync(path.join(PDF_DIR, "narrative.es.md"), "utf8");
const branchLabels = JSON.parse(fs.readFileSync(path.join(PDF_DIR, "branch-labels.json"), "utf8"));

const args = { bundleMd, narrativeMd, branchLabels };

describe("composeMarkdown — presentable Markdown report (SCEN-010)", () => {
  it("is byte-identical across two calls on identical inputs", () => {
    expect(composeMarkdown(args)).toBe(composeMarkdown(args));
  });

  it("opens with a top-level title and the analyzed period", () => {
    const md = composeMarkdown(args);
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain("**Periodo analizado:** mayo 2024 – mayo 2026");
  });

  it("carries the 4 Spanish narrative headings verbatim", () => {
    const md = composeMarkdown(args);
    expect(md).toContain("## Demanda por sucursal y mes");
    expect(md).toContain("## Precios por gama");
    expect(md).toContain("## Cotizaciones fallidas");
    expect(md).toContain("## Disponibilidad y comportamiento de reserva");
  });

  it("relabels branch codes and reaches the data in GFM tables", () => {
    const md = composeMarkdown(args);
    expect(md).toContain("Bogotá"); // AABOT relabeled
    expect(md).toContain("63258"); // 01a AABOT searches
    // a GFM delimiter row exists (numeric columns are right-aligned)
    expect(md).toMatch(/\|\s*---:?\s*\|/);
    // table caption pulled from the bundle's own cut description
    expect(md).toContain("01a — top pickup branches");
  });

  it("falls back to the raw code for an unmapped branch (ACBED)", () => {
    const md = composeMarkdown(args);
    expect(md).toContain("ACBED");
  });

  it("SCEN-007: carries the Report 05 heading and its per-day cut tables", () => {
    const md = composeMarkdown(args);
    expect(md).toContain("## Anticipación de precios");
    // the per-(duration band × lead bucket) cut caption, sourced from the bundle marker
    expect(md).toContain("05c — curve inputs per (duration band × lead bucket)");
    // a per-day lead bucket value reached a GFM table
    expect(md).toContain("09_90plus");
  });

  it("omits the heading line when a narrative block has no heading (no bare '## ')", () => {
    const noHeading = narrativeMd.replace("## Demanda por sucursal y mes", "");
    const md = composeMarkdown({ ...args, narrativeMd: noHeading });
    expect(md).not.toContain("\n## \n");
  });
});
