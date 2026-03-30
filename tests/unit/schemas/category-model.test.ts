import { describe, it, expect } from "vitest";
import { categoryModelSchema } from "@/lib/schemas/category-model";

describe("categoryModelSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts valid category model data", () => {
    const result = categoryModelSchema.safeParse({
      category_id: uuid,
      name: "Renault Kwid 1.0",
      image_url: "https://example.com/kwid.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("requires category_id as uuid", () => {
    const result = categoryModelSchema.safeParse({
      category_id: "bad",
      name: "Renault Kwid",
    });
    expect(result.success).toBe(false);
  });

  it("requires name", () => {
    const result = categoryModelSchema.safeParse({
      category_id: uuid,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults is_default to false", () => {
    const result = categoryModelSchema.safeParse({
      category_id: uuid,
      name: "Suzuki Swift",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_default).toBe(false);
  });
});
