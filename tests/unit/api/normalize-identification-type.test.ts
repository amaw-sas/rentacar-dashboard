import { describe, it, expect } from "vitest";
import { normalizeIdentificationType } from "@/lib/api/normalize-identification-type";

// Scenarios:
// - Legacy verbose values from rentacar-main ("Cedula Ciudadania", "Pasaporte",
//   "Cedula Extranjeria") map to the DB check constraint codes (CC, PP, CE).
// - Already-normalized codes pass through unchanged.
// - Unknown values pass through unchanged so the DB check constraint fails
//   loudly — we don't silently substitute a default.
// - Case-insensitive for verbose mappings so "cedula ciudadania" or
//   "CEDULA CIUDADANIA" both normalize.

describe("normalizeIdentificationType", () => {
  it("maps legacy verbose values to DB codes", () => {
    expect(normalizeIdentificationType("Cedula Ciudadania")).toBe("CC");
    expect(normalizeIdentificationType("Pasaporte")).toBe("PP");
    expect(normalizeIdentificationType("Cedula Extranjeria")).toBe("CE");
  });

  it("is case-insensitive for verbose mappings", () => {
    expect(normalizeIdentificationType("cedula ciudadania")).toBe("CC");
    expect(normalizeIdentificationType("CEDULA EXTRANJERIA")).toBe("CE");
  });

  it("passes through already-normalized DB codes", () => {
    expect(normalizeIdentificationType("CC")).toBe("CC");
    expect(normalizeIdentificationType("CE")).toBe("CE");
    expect(normalizeIdentificationType("NIT")).toBe("NIT");
    expect(normalizeIdentificationType("PP")).toBe("PP");
    expect(normalizeIdentificationType("TI")).toBe("TI");
  });

  it("passes through unknown values unchanged", () => {
    // We do not silently map unknown values — let the DB reject them.
    expect(normalizeIdentificationType("DNI")).toBe("DNI");
    expect(normalizeIdentificationType("")).toBe("");
  });
});
