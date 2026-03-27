import { describe, it, expect } from "vitest";
import { rentalCompanySchema } from "@/lib/schemas/rental-company";

describe("rentalCompanySchema", () => {
  const valid = {
    name: "Localiza",
    code: "localiza",
    commission_rate_min: 10,
    commission_rate_max: 15,
    contact_name: "Juan Perez",
    contact_email: "juan@localiza.com",
    contact_phone: "+57 300 1234567",
    api_base_url: "https://nr.localiza.com",
    extra_driver_day_price: 12000,
    baby_seat_day_price: 12000,
    wash_price: 20000,
    status: "active" as const,
  };

  it("accepts valid rental company data", () => {
    const result = rentalCompanySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires name", () => {
    const result = rentalCompanySchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("requires code", () => {
    const result = rentalCompanySchema.safeParse({ ...valid, code: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = rentalCompanySchema.safeParse({ ...valid, status: "deleted" });
    expect(result.success).toBe(false);
  });

  it("allows optional commission rates as null", () => {
    const result = rentalCompanySchema.safeParse({
      ...valid,
      commission_rate_min: null,
      commission_rate_max: null,
    });
    expect(result.success).toBe(true);
  });

  it("defaults optional fields", () => {
    const minimal = { name: "Avis", code: "avis" };
    const result = rentalCompanySchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.extra_driver_day_price).toBe(0);
    }
  });
});
