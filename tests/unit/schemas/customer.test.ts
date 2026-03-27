import { describe, it, expect } from "vitest";
import { customerSchema } from "@/lib/schemas/customer";

describe("customerSchema", () => {
  const valid = {
    first_name: "Juan",
    last_name: "Perez",
    identification_type: "CC" as const,
    identification_number: "1234567890",
    phone: "+57 300 1234567",
    email: "juan@example.com",
    notes: "",
    status: "active" as const,
  };

  it("accepts valid customer data", () => {
    const result = customerSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires first_name", () => {
    const result = customerSchema.safeParse({ ...valid, first_name: "" });
    expect(result.success).toBe(false);
  });

  it("requires last_name", () => {
    const result = customerSchema.safeParse({ ...valid, last_name: "" });
    expect(result.success).toBe(false);
  });

  it("requires valid identification_type", () => {
    const result = customerSchema.safeParse({ ...valid, identification_type: "DNI" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid identification types", () => {
    for (const type of ["CC", "CE", "NIT", "PP", "TI"]) {
      const result = customerSchema.safeParse({ ...valid, identification_type: type });
      expect(result.success).toBe(true);
    }
  });

  it("requires identification_number", () => {
    const result = customerSchema.safeParse({ ...valid, identification_number: "" });
    expect(result.success).toBe(false);
  });

  it("requires valid email", () => {
    const result = customerSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("defaults optional fields", () => {
    const minimal = {
      first_name: "Ana",
      last_name: "Garcia",
      identification_type: "CC" as const,
      identification_number: "9876543210",
      email: "ana@example.com",
    };
    const result = customerSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.phone).toBe("");
    }
  });
});
