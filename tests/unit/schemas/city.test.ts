import { describe, it, expect } from "vitest";
import { citySchema } from "@/lib/schemas/city";

describe("citySchema", () => {
  it("accepts valid city data", () => {
    const result = citySchema.safeParse({ name: "Bogotá", slug: "bogota" });
    expect(result.success).toBe(true);
  });

  it("requires name", () => {
    const result = citySchema.safeParse({ name: "", slug: "bogota" });
    expect(result.success).toBe(false);
  });

  it("requires slug", () => {
    const result = citySchema.safeParse({ name: "Bogotá", slug: "" });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL-safe slug", () => {
    const result = citySchema.safeParse({ name: "Bogotá", slug: "Bogotá Capital" });
    expect(result.success).toBe(false);
  });

  it("accepts slug with hyphens", () => {
    const result = citySchema.safeParse({ name: "Santa Marta", slug: "santa-marta" });
    expect(result.success).toBe(true);
  });

  it("defaults status to active", () => {
    const result = citySchema.safeParse({ name: "Cali", slug: "cali" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("active");
  });
});
