import { describe, it, expect } from "vitest";
import { categoryPricingSchema } from "@/lib/schemas/category-pricing";

describe("categoryPricingSchema", () => {
  const valid = {
    category_id: "550e8400-e29b-41d4-a716-446655440000",
    total_coverage_unit_charge: 45000,
    monthly_1k_price: 1800000,
    monthly_2k_price: 2200000,
    monthly_3k_price: 2600000,
    monthly_insurance_price: 350000,
    monthly_one_day_price: 85000,
    valid_from: "2026-01-01",
    valid_until: "2026-12-31",
    status: "active" as const,
  };

  it("accepts valid pricing data", () => {
    const result = categoryPricingSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("allows null monthly prices", () => {
    const result = categoryPricingSchema.safeParse({
      ...valid,
      monthly_1k_price: null,
      monthly_2k_price: null,
      monthly_3k_price: null,
    });
    expect(result.success).toBe(true);
  });

  it("allows null valid_until (indefinite)", () => {
    const result = categoryPricingSchema.safeParse({ ...valid, valid_until: null });
    expect(result.success).toBe(true);
  });

  it("requires category_id as uuid", () => {
    const result = categoryPricingSchema.safeParse({ ...valid, category_id: "bad" });
    expect(result.success).toBe(false);
  });

  it("requires non-negative total_coverage_unit_charge", () => {
    const result = categoryPricingSchema.safeParse({ ...valid, total_coverage_unit_charge: -1 });
    expect(result.success).toBe(false);
  });
});
