import { describe, it, expect } from "vitest";
import { franchiseSchema } from "@/lib/schemas/franchise";

describe("franchiseSchema", () => {
  const valid = {
    code: "alquilatucarro",
    display_name: "Alquila tu Carro",
    website: "https://alquilatucarro.com",
    phone: "+57 301 672 9250",
    whatsapp: "+57 301 672 9250",
    logo_url: "https://example.com/logo.png",
    sender_email: "reservas@alquilatucarro.com",
    sender_name: "Alquila tu Carro",
    status: "active" as const,
  };

  it("accepts valid franchise data", () => {
    const result = franchiseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires code", () => {
    const result = franchiseSchema.safeParse({ ...valid, code: "" });
    expect(result.success).toBe(false);
  });

  it("requires display_name", () => {
    const result = franchiseSchema.safeParse({ ...valid, display_name: "" });
    expect(result.success).toBe(false);
  });

  it("requires sender_email as valid email", () => {
    const result = franchiseSchema.safeParse({ ...valid, sender_email: "not-email" });
    expect(result.success).toBe(false);
  });

  it("defaults optional fields", () => {
    const minimal = {
      code: "alquilame",
      display_name: "Alquilame",
      sender_email: "info@alquilame.co",
      sender_name: "Alquilame",
    };
    const result = franchiseSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.phone).toBe("");
    }
  });
});
