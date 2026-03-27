import { describe, it, expect } from "vitest";
import { vehicleCategorySchema } from "@/lib/schemas/vehicle-category";

describe("vehicleCategorySchema", () => {
  const valid = {
    rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
    code: "ECON",
    name: "Económico",
    description: "Vehículo económico",
    image_url: "https://example.com/econ.jpg",
    passenger_count: 5,
    luggage_count: 2,
    has_ac: true,
    transmission: "manual" as const,
    status: "active" as const,
  };

  it("accepts valid category data", () => {
    const result = vehicleCategorySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid transmission", () => {
    const result = vehicleCategorySchema.safeParse({ ...valid, transmission: "cvt" });
    expect(result.success).toBe(false);
  });

  it("requires non-negative passenger_count", () => {
    const result = vehicleCategorySchema.safeParse({ ...valid, passenger_count: -1 });
    expect(result.success).toBe(false);
  });

  it("defaults optional fields", () => {
    const minimal = {
      rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
      code: "SUV",
      name: "SUV Grande",
    };
    const result = vehicleCategorySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transmission).toBe("manual");
      expect(result.data.has_ac).toBe(true);
    }
  });
});
