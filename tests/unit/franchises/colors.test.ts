import { describe, it, expect } from "vitest";
import {
  franchiseColor,
  FRANCHISE_COLORS,
  FRANCHISE_FALLBACK_COLORS,
} from "@/lib/franchises/colors";

describe("franchiseColor", () => {
  it("returns the brand color for a known franchise code, ignoring index", () => {
    expect(franchiseColor("alquilatucarro", 0)).toBe("#2563eb");
    expect(franchiseColor("alquilame", 99)).toBe("#dc2626");
    expect(franchiseColor("alquicarros", 2)).toBe("#d97706");
  });

  it("cycles the fallback palette by index for unknown codes", () => {
    expect(franchiseColor("nuevo", 0)).toBe(FRANCHISE_FALLBACK_COLORS[0]);
    expect(franchiseColor("nuevo", 1)).toBe(FRANCHISE_FALLBACK_COLORS[1]);
    expect(franchiseColor("otro", FRANCHISE_FALLBACK_COLORS.length)).toBe(
      FRANCHISE_FALLBACK_COLORS[0],
    );
  });

  it("keeps the three brand franchises mapped", () => {
    expect(Object.keys(FRANCHISE_COLORS).sort()).toEqual([
      "alquicarros",
      "alquilame",
      "alquilatucarro",
    ]);
  });
});
