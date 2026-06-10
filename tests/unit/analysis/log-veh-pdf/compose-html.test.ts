import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// compose-html.mjs is pure ESM without type declarations; allowJs infers it as untyped.
import { composeHtml } from "../../../../scripts/analysis/log-veh/pdf/compose-html.mjs";

const PDF_DIR = path.resolve(process.cwd(), "scripts/analysis/log-veh/pdf");
const BUNDLE_PATH = path.resolve(
  process.cwd(),
  "docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md",
);

const bundleMd = fs.readFileSync(BUNDLE_PATH, "utf8");
const narrativeMd = fs.readFileSync(path.join(PDF_DIR, "narrative.es.md"), "utf8");
const branchLabels = JSON.parse(fs.readFileSync(path.join(PDF_DIR, "branch-labels.json"), "utf8"));
const themeCss = fs.readFileSync(path.join(PDF_DIR, "theme.css"), "utf8");

const args = { bundleMd, narrativeMd, branchLabels, themeCss, reportDate: "2026-06-09" };

describe("composeHtml — issue #45 PDF report composer", () => {
  it("SCEN-003: byte-identical HTML across two calls on identical inputs", () => {
    const h1 = composeHtml(args);
    const h2 = composeHtml(args);
    expect(h1).toBe(h2);
  });

  it("SCEN-006: each of the 4 sections contains its Spanish narrative sentinel verbatim", () => {
    const h1 = composeHtml(args);
    expect(h1).toContain("Demanda por sucursal y mes");
    expect(h1).toContain("Precios por gama");
    expect(h1).toContain("Cotizaciones fallidas");
    expect(h1).toContain("Disponibilidad y comportamiento de reserva");
  });

  it("relabels mapped branch codes (AABOT -> Bogotá) and keeps unmapped codes raw", () => {
    const h1 = composeHtml(args);
    expect(h1).toContain("Bogotá");
    // Fallback path: a code absent from branch-labels.json stays verbatim.
    const fallback = composeHtml({
      ...args,
      bundleMd: bundleMd.replace(/AABOT/g, "ZZZNO"),
    });
    expect(fallback).toContain("ZZZNO");
  });

  it("data reached the backing tables (01a AABOT searches, 01b 2025-12 searches)", () => {
    const h1 = composeHtml(args);
    expect(h1).toContain("63258");
    expect(h1).toContain("48344");
  });

  it("sanity: output is a full HTML document with inline SVG charts", () => {
    const h1 = composeHtml(args);
    expect(h1.toLowerCase().startsWith("<!doctype html")).toBe(true);
    expect(h1).toContain("<svg");
  });
});
