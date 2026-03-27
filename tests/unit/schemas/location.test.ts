import { describe, it, expect } from "vitest";
import { locationSchema } from "@/lib/schemas/location";

describe("locationSchema", () => {
  const valid = {
    rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
    code: "AABOT",
    name: "Bogotá Aeropuerto",
    city: "Bogotá",
    address: "Aeropuerto El Dorado",
    schedule: { mon: "08:00-18:00" },
    slug: "bogota-aeropuerto",
    status: "active" as const,
  };

  it("accepts valid location data", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires rental_company_id as uuid", () => {
    const result = locationSchema.safeParse({ ...valid, rental_company_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("requires code", () => {
    const result = locationSchema.safeParse({ ...valid, code: "" });
    expect(result.success).toBe(false);
  });

  it("requires name", () => {
    const result = locationSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("defaults optional fields", () => {
    const minimal = {
      rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
      code: "AABOT",
      name: "Bogotá",
    };
    const result = locationSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.city).toBe("");
    }
  });
});
