import { describe, it, expect } from "vitest";
import { referralSchema } from "@/lib/schemas/referral";

describe("referralSchema", () => {
  const valid = {
    code: "hotel-dann-carlton",
    name: "Hotel Dann Carlton",
    type: "hotel" as const,
    contact_name: "Maria Lopez",
    contact_email: "maria@dann.com",
    contact_phone: "+57 300 1234567",
    commission_notes: "10% sobre reservas confirmadas",
    notes: "Aliado desde 2024",
    status: "active" as const,
  };

  it("accepts valid referral data", () => {
    const result = referralSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires code", () => {
    const result = referralSchema.safeParse({ ...valid, code: "" });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL-safe code", () => {
    const result = referralSchema.safeParse({ ...valid, code: "has spaces!" });
    expect(result.success).toBe(false);
  });

  it("accepts URL-safe codes with hyphens and numbers", () => {
    const result = referralSchema.safeParse({ ...valid, code: "hotel-123-bogota" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = referralSchema.safeParse({ ...valid, type: "unknown" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid types", () => {
    for (const type of ["company", "hotel", "salesperson", "other"]) {
      const result = referralSchema.safeParse({ ...valid, type });
      expect(result.success).toBe(true);
    }
  });

  it("defaults optional fields", () => {
    const minimal = { code: "test-ref", name: "Test", type: "other" as const };
    const result = referralSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.commission_notes).toBe("");
    }
  });
});
