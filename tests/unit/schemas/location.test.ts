import { describe, it, expect } from "vitest";
import { locationSchema } from "@/lib/schemas/location";

describe("locationSchema", () => {
  const valid = {
    rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
    code: "AABOT",
    name: "Bogotá Aeropuerto",
    city: "",
    city_id: "650e8400-e29b-41d4-a716-446655440111",
    pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
    pickup_map: "https://maps.app.goo.gl/abc",
    schedule: { mon: "08:00-18:00" },
    slug: "bogota-aeropuerto",
    status: "active" as const,
  };

  it("accepts valid location data", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts optional return_address and return_map", () => {
    const result = locationSchema.safeParse({
      ...valid,
      return_address: "Av Otro Lugar",
      return_map: "https://maps.app.goo.gl/xyz",
    });
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

  it("requires non-empty pickup_address", () => {
    const result = locationSchema.safeParse({ ...valid, pickup_address: "" });
    expect(result.success).toBe(false);
  });

  it("requires non-empty pickup_map", () => {
    const result = locationSchema.safeParse({ ...valid, pickup_map: "" });
    expect(result.success).toBe(false);
  });

  it("defaults return fields to null", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.return_address).toBeNull();
      expect(result.data.return_map).toBeNull();
      expect(result.data.status).toBe("active");
    }
  });

  it("requires city_id as uuid — city is now resolved via the cities catalog", () => {
    const result = locationSchema.safeParse({ ...valid, city_id: null });
    expect(result.success).toBe(false);
  });

  it("rejects empty string for city_id", () => {
    const result = locationSchema.safeParse({ ...valid, city_id: "" });
    expect(result.success).toBe(false);
  });
});
