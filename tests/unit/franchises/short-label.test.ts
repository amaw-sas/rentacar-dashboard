import { describe, it, expect } from "vitest";
import { franchiseShortLabel } from "@/lib/franchises/short-label";

describe("franchiseShortLabel", () => {
  it("takes camelCase initials", () => {
    expect(franchiseShortLabel("AlquilaTuCarro")).toBe("ATC");
    expect(franchiseShortLabel("AlquiCarros")).toBe("AC");
  });

  it("takes space/hyphen-separated initials", () => {
    expect(franchiseShortLabel("Alquila Tu Carro")).toBe("ATC");
    expect(franchiseShortLabel("Rent-A-Car")).toBe("RAC");
  });

  it("falls back to the first three letters for a single-initial name", () => {
    expect(franchiseShortLabel("Alquílame")).toBe("ALQ");
    expect(franchiseShortLabel("hertz")).toBe("HER");
  });

  it("caps the abbreviation at four characters", () => {
    expect(franchiseShortLabel("A B C D E F")).toBe("ABCD");
  });

  it("degrades gracefully on empty/whitespace input", () => {
    expect(franchiseShortLabel("")).toBe("?");
    expect(franchiseShortLabel("   ")).toBe("?");
  });
});
