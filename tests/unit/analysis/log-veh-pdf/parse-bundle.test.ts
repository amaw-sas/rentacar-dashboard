import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// parse-bundle.mjs is pure ESM without type declarations; allowJs infers it as untyped.
import { numAt, parseBundle } from "../../../../scripts/analysis/log-veh/pdf/parse-bundle.mjs";

type Cut = { columns: string[]; rows: Record<string, string>[] };
type Bundle = Record<string, Record<string, Cut>>;

const BUNDLE_PATH = path.resolve(
  process.cwd(),
  "docs/data-ops/2026-06-09-issue-45-phase35-dataset/reports/log-veh-reports-2026-06-09.md",
);

const bundle = fs.readFileSync(BUNDLE_PATH, "utf8");

describe("parseBundle — real committed log_veh report bundle", () => {
  it("SCEN-002: yields 01a AABOT searches=63258 and 01b 2025-12 searches=48344", () => {
    const parsed = parseBundle(bundle) as unknown as Bundle;

    const a = parsed["01"]["01a"];
    const aabot = a.rows.find((r: Record<string, string>) => r.pickup_location === "AABOT");
    expect(aabot).toBeDefined();
    expect(numAt(aabot, "searches")).toBe(63258);

    const b = parsed["01"]["01b"];
    // 01b columns: month_utc, searches, pct_of_all.
    const dec = b.rows.find(
      (r: Record<string, string>) =>
        r.month_utc === "2025-12" || Object.values(r).includes("2025-12"),
    );
    expect(dec).toBeDefined();
    expect(numAt(dec, "searches")).toBe(48344);
  });

  it("section/subsection markers never appear as data rows", () => {
    const parsed = parseBundle(bundle) as unknown as Bundle;

    for (const report of Object.values(parsed) as Array<Record<string, { rows: Record<string, string>[] }>>) {
      for (const cut of Object.values(report)) {
        for (const row of cut.rows) {
          const first = Object.values(row)[0] as string;
          expect(first).not.toMatch(/^=== REPORT/);
          expect(first).not.toMatch(/^--- \d/);
          expect(first).not.toBe("section");
          expect(first).not.toBe("subsection");
        }
      }
    }
  });

  it("legitimate zero parses: 04c z_unparseable_or_null pct=0.0 -> 0", () => {
    const parsed = parseBundle(bundle) as unknown as Bundle;
    // 04c columns: bucket, searches, pct.
    const row = parsed["04"]["04c"].rows.find(
      (r: Record<string, string>) => r.bucket === "z_unparseable_or_null",
    );
    expect(row).toBeDefined();
    expect(numAt(row, "pct")).toBe(0);
  });

  it("numAt fails loud on an empty/blank cell (no silent zero)", () => {
    expect(() => numAt({ c: "" }, "c")).toThrow(/empty\/blank/);
    expect(() => numAt({ c: "   " }, "c")).toThrow(/empty\/blank/);
    expect(() => numAt({}, "c")).toThrow(/empty\/blank/);
    // a genuine zero is still valid data
    expect(numAt({ c: "0" }, "c")).toBe(0);
    expect(numAt({ c: "0.0" }, "c")).toBe(0);
  });

  it("SCEN-007: parses Report 05 cuts 05a–05f from the bundle", () => {
    const parsed = parseBundle(bundle) as unknown as Bundle;
    for (const cut of ["05a", "05b", "05c", "05d", "05e", "05f"]) {
      expect(parsed["05"]?.[cut]?.rows?.length ?? 0).toBeGreaterThan(0);
    }
    // 05f reconciles to the full corpus across its six counts.
    const f = parsed["05"]["05f"].rows[0];
    const sum =
      numAt(f, "dropped_null_lead") +
      numAt(f, "dropped_negative_lead") +
      numAt(f, "dropped_null_price") +
      numAt(f, "dropped_null_category") +
      numAt(f, "dropped_bad_duration") +
      numAt(f, "n_quotes_analyzed");
    expect(sum).toBe(2974126);
  });

  it("SCEN-007: a bundle missing a 05 cut throws naming it (MANIFEST guards 05)", () => {
    const lines = bundle.split(/\r?\n/);
    const out: string[] = [];
    let dropping = false;
    for (const line of lines) {
      const t = line.trim();
      if (/^\| --- 05c:/.test(t)) {
        dropping = true;
        continue;
      }
      if (dropping) {
        if (/^\| --- \d+[a-z]:/.test(t) || /^\| === REPORT/.test(t)) {
          dropping = false;
          out.push(line);
          continue;
        }
        continue;
      }
      out.push(line);
    }
    expect(() => parseBundle(out.join("\n"))).toThrow(/05c/);
  });

  it("SCEN-004: removing the 01a table block throws naming the missing cut", () => {
    // Delete the entire 01a block: marker line + header + data rows, up to the next marker.
    const lines = bundle.split(/\r?\n/);
    const out: string[] = [];
    let dropping = false;
    for (const line of lines) {
      const t = line.trim();
      if (/^\| --- 01a:/.test(t)) {
        dropping = true;
        continue;
      }
      if (dropping) {
        // Stop dropping when the next subsection/report marker is reached.
        if (/^\| --- \d+[a-z]:/.test(t) || /^\| === REPORT/.test(t)) {
          dropping = false;
          out.push(line);
          continue;
        }
        continue;
      }
      out.push(line);
    }
    const mutated = out.join("\n");

    expect(() => parseBundle(mutated)).toThrow(/01a/);
  });
});
