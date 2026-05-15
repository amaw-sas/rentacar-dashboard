import { describe, it, expect } from "vitest";
import { customerSchema, customerContactSchema } from "@/lib/schemas/customer";

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

describe("customerContactSchema", () => {
  const validContact = {
    first_name: "Juan",
    last_name: "Perez",
    identification_type: "CC" as const,
    identification_number: "1234567890",
    phone: "+57 300 1234567",
    email: "juan@example.com",
  };

  it("accepts a valid contact payload", () => {
    const result = customerContactSchema.safeParse(validContact);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      email: "noesunemail",
    });
    expect(result.success).toBe(false);
  });

  it("requires first_name", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      first_name: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires last_name", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      last_name: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires identification_number", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      identification_number: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an identification_type outside the enum", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      identification_type: "DNI",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty phone (only non-required string)", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      phone: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects whitespace-only first_name / last_name / identification_number", () => {
    for (const field of [
      "first_name",
      "last_name",
      "identification_number",
    ] as const) {
      const result = customerContactSchema.safeParse({
        ...validContact,
        [field]: "   ",
      });
      expect(result.success, `${field} whitespace-only must fail`).toBe(false);
    }
  });

  it("trims leading/trailing whitespace in the parsed output", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      first_name: "  Juan  ",
      last_name: "  Perez  ",
      identification_number: "  1234567890  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.first_name).toBe("Juan");
      expect(result.data.last_name).toBe("Perez");
      expect(result.data.identification_number).toBe("1234567890");
    }
  });

  it("strips notes and status — output never carries them", () => {
    const result = customerContactSchema.safeParse({
      ...validContact,
      notes: "cliente VIP",
      status: "inactive",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("notes" in result.data).toBe(false);
      expect("status" in result.data).toBe(false);
      expect(Object.keys(result.data).sort()).toEqual([
        "email",
        "first_name",
        "identification_number",
        "identification_type",
        "last_name",
        "phone",
      ]);
    }
  });
});
