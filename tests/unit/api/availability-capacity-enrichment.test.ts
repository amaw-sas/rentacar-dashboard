import { describe, it, expect } from "vitest";
import { enrichCategoryCapacity } from "@/lib/api/availability-capacity-enrichment";
import type { CategoryCapacity } from "@/lib/api/category-capacity";

const CAP_C: CategoryCapacity = {
  passengerCount: 5,
  luggageCount: 4,
  transmission: "automatic",
  hasAc: true,
  picoyplacaExempt: false,
};

describe("enrichCategoryCapacity", () => {
  it("merges capacity fields onto the matching gama and preserves passthrough", () => {
    const items = [
      { categoryCode: "C", categoryDescription: "Económico", totalAmount: 100 },
    ];
    const [out] = enrichCategoryCapacity(items, new Map([["C", CAP_C]]));

    expect(out.passengerCount).toBe(5);
    expect(out.luggageCount).toBe(4);
    expect(out.transmission).toBe("automatic");
    expect(out.hasAc).toBe(true);
    expect(out.picoyplacaExempt).toBe(false);
    // Passthrough fields untouched.
    expect(out.categoryDescription).toBe("Económico");
    expect(out.totalAmount).toBe(100);
  });

  it("passes an uncurated gama through UNCHANGED (no capacity fields, not zeros)", () => {
    const items = [{ categoryCode: "ZZ", categoryDescription: "Nueva", totalAmount: 9 }];
    const [out] = enrichCategoryCapacity(items, new Map([["C", CAP_C]]));

    expect(out).not.toHaveProperty("passengerCount");
    expect(out).not.toHaveProperty("transmission");
    expect(out.categoryDescription).toBe("Nueva");
    expect(out.totalAmount).toBe(9);
  });

  it("does not mutate the input items", () => {
    const item = { categoryCode: "C", totalAmount: 1 };
    const items = [item];
    enrichCategoryCapacity(items, new Map([["C", CAP_C]]));

    expect(item).not.toHaveProperty("passengerCount");
    expect(Object.keys(item)).toEqual(["categoryCode", "totalAmount"]);
  });

  it("an empty map leaves every item unchanged", () => {
    const items = [
      { categoryCode: "C", totalAmount: 1 },
      { categoryCode: "D", totalAmount: 2 },
    ];
    const out = enrichCategoryCapacity(items, new Map());

    expect(out).toEqual(items);
  });
});
