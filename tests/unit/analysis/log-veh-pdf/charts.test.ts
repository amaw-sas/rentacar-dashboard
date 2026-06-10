import { describe, it, expect } from "vitest";
// charts.mjs is pure ESM with no type declarations; allowJs infers it as untyped.
import { hbar, vbar, line, fmtInt } from "@/scripts/analysis/log-veh/pdf/charts.mjs";

const DOTTED_QUAD = /[0-9]{1,3}(\.[0-9]{1,3}){3}/;

describe("charts.mjs — fmtInt", () => {
  it("renders raw integers with no separators or abbreviation", () => {
    expect(fmtInt(48344)).toBe("48344");
    expect(fmtInt(1269025.0)).toBe("1269025");
    expect(fmtInt(90.685)).toBe("91");
  });
});

describe("charts.mjs — SCEN-003 byte-determinism", () => {
  it("hbar emits byte-identical SVG across two calls on the same input", () => {
    const series = [
      { label: "SUV MANUAL", value: 12345 },
      { label: "SEDAN AUTO", value: 6789 },
      { label: "PICKUP 4X4", value: 3210 },
    ];
    const opts = { width: 800, height: 240, title: "Top categorias" };
    expect(hbar(series, opts)).toBe(hbar(series, opts));
  });

  it("vbar emits byte-identical SVG across two calls on the same input", () => {
    const series = [
      { label: "ene", value: 100 },
      { label: "feb", value: 250 },
      { label: "mar", value: 175 },
    ];
    const opts = { width: 800, height: 300, title: "Por mes" };
    expect(vbar(series, opts)).toBe(vbar(series, opts));
  });

  it("line emits byte-identical SVG across two calls on the same input", () => {
    const series = [
      { x: "2025-10", y: 41000 },
      { x: "2025-11", y: 46000 },
      { x: "2025-12", y: 48344 },
    ];
    const opts = { width: 800, height: 300, title: "Busquedas por mes" };
    expect(line(series, opts)).toBe(line(series, opts));
  });
});

describe("charts.mjs — SCEN-008 R01 searches-per-month line label", () => {
  it("renders the 2025-12 value 48344 as a raw integer text node", () => {
    const svg = line(
      [
        { x: "2025-11", y: 46000 },
        { x: "2025-12", y: 48344 },
      ],
      { width: 800, height: 300 }
    );
    expect(svg).toContain(">48344<");
    expect(svg).not.toContain("48,344");
    expect(svg).not.toContain("48.344");
    expect(svg).not.toContain("48.3k");
  });
});

describe("charts.mjs — SCEN-005 no IPv4-shaped dotted quad", () => {
  it("hbar output contains no four-group dotted token", () => {
    const svg = hbar(
      [
        { label: "SUV MANUAL", value: 1269025 },
        { label: "SEDAN AUTO", value: 48344 },
      ],
      { width: 800, height: 200 }
    );
    expect(svg).not.toMatch(DOTTED_QUAD);
  });

  it("vbar output contains no four-group dotted token", () => {
    const svg = vbar(
      [
        { label: "q1", value: 12345 },
        { label: "q2", value: 67890 },
      ],
      { width: 800, height: 300 }
    );
    expect(svg).not.toMatch(DOTTED_QUAD);
  });

  it("line output contains no four-group dotted token", () => {
    const svg = line(
      [
        { x: "2025-11", y: 46000 },
        { x: "2025-12", y: 48344 },
      ],
      { width: 800, height: 300 }
    );
    expect(svg).not.toMatch(DOTTED_QUAD);
  });

  it("negative values never emit an invalid negative SVG width/height", () => {
    const h = hbar([{ label: "A", value: -100 }, { label: "B", value: 50 }], { width: 800, height: 200 });
    const v = vbar([{ label: "q1", value: -100 }, { label: "q2", value: 50 }], { width: 800, height: 300 });
    expect(h).not.toMatch(/width="-/);
    expect(h).not.toMatch(/height="-/);
    expect(v).not.toMatch(/width="-/);
    expect(v).not.toMatch(/height="-/);
  });

  it("hbar with a float value still emits integer-only, dotted-quad-free SVG", () => {
    const svg = hbar(
      [
        { label: "utilization", value: 90.685 },
        { label: "cancellation", value: 1269025.0 },
      ],
      { width: 800, height: 200 }
    );
    expect(svg).not.toMatch(DOTTED_QUAD);
    // float-rounded label is a raw integer
    expect(svg).toContain(">91<");
    expect(svg).toContain(">1269025<");
    // no fractional coordinate leaked into the markup
    expect(svg).not.toMatch(/\d\.\d/);
  });
});
