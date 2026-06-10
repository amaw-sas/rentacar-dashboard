import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  enrichCategoryDescriptions,
  type AvailabilityItem,
} from "@/lib/api/availability-enrichment";

describe("enrichCategoryDescriptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // SCEN-001: a code present in the injected map → categoryDescription becomes
  // the curated Spanish name, NOT the raw Portuguese input.
  it("replaces the description with the Spanish name when the code is mapped", () => {
    const items: AvailabilityItem[] = [
      {
        categoryCode: "C",
        categoryDescription: "ECONÔMICO COM AR",
        totalAmount: 123.45,
      },
    ];
    const nameMap = new Map([["C", "Gama C Económico Mecánico"]]);

    const [out] = enrichCategoryDescriptions(items, nameMap);

    expect(out.categoryDescription).toBe("Gama C Económico Mecánico");
    expect(out.categoryDescription).not.toBe("ECONÔMICO COM AR");
  });

  // SCEN-002: a code absent from the map → description unchanged (raw PT, never
  // blank) AND console.warn emits a parseable localiza_category_unmapped event
  // carrying the missing code.
  it("keeps the raw description and logs an unmapped warning when the code is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: AvailabilityItem[] = [
      { categoryCode: "ZZ", categoryDescription: "GAMA NOVA PT" },
    ];
    const nameMap = new Map<string, string>();

    const [out] = enrichCategoryDescriptions(items, nameMap);

    // Description preserved verbatim — never blank.
    expect(out.categoryDescription).toBe("GAMA NOVA PT");
    expect(out.categoryDescription).not.toBe("");

    // Exactly one warning, parseable to the expected structured event.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      event: "localiza_category_unmapped",
      categoryCode: "ZZ",
    });
  });

  // SCEN-004: N≥2 items with extra fields → every non-description field is
  // byte-equal to the input; only categoryDescription changes for mapped items.
  // Forbids any "return only the description" shortcut.
  it("preserves all other fields and only mutates categoryDescription", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: AvailabilityItem[] = [
      {
        categoryCode: "C",
        categoryDescription: "ECONÔMICO COM AR",
        totalAmount: 200,
        referenceToken: "tok-c",
        IVAFeeAmount: 38,
      },
      {
        categoryCode: "ZZ",
        categoryDescription: "GAMA NOVA PT",
        totalAmount: 999,
        referenceToken: "tok-zz",
        IVAFeeAmount: 0,
      },
    ];
    const nameMap = new Map([["C", "Gama C Económico Mecánico"]]);

    const result = enrichCategoryDescriptions(items, nameMap);

    expect(result).toHaveLength(2);

    // Mapped item: description changed, everything else byte-equal.
    expect(result[0].categoryDescription).toBe("Gama C Económico Mecánico");
    const omitDescription = ({
      categoryDescription,
      ...rest
    }: AvailabilityItem): Omit<AvailabilityItem, "categoryDescription"> => {
      void categoryDescription;
      return rest;
    };
    expect(omitDescription(result[0])).toEqual(omitDescription(items[0]));

    // Unmapped item: untouched entirely.
    expect(result[1]).toEqual(items[1]);
  });

  // SCEN-006: same input through two different maps → outputs differ
  // accordingly. Proves the source of truth is the injected map, not a literal.
  it("derives the description from the injected map, not a hardcoded literal", () => {
    const item: AvailabilityItem = {
      categoryCode: "C",
      categoryDescription: "ECONÔMICO COM AR",
    };

    const [outX] = enrichCategoryDescriptions([item], new Map([["C", "X"]]));
    const [outY] = enrichCategoryDescriptions([item], new Map([["C", "Y"]]));

    expect(outX.categoryDescription).toBe("X");
    expect(outY.categoryDescription).toBe("Y");
    expect(outX.categoryDescription).not.toBe(outY.categoryDescription);
  });
});
