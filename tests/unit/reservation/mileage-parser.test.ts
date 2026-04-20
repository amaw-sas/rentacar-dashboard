import { describe, it, expect } from "vitest";
import { parseMonthlyMileage } from "@/lib/reservation/mileage-parser";

describe("parseMonthlyMileage", () => {
  it.each([
    ["1k_kms", 1000],
    ["2k_kms", 2000],
    ["3k_kms", 3000],
  ])("maps the legacy enum %s → %d", (input, expected) => {
    expect(parseMonthlyMileage(input)).toBe(expected);
  });

  it.each([1000, 2000, 3000])("keeps canonical integer %d unchanged", (n) => {
    expect(parseMonthlyMileage(n)).toBe(n);
  });

  it.each([
    [1, 1000],
    [2, 2000],
    [3, 3000],
  ])("rescues legacy small integer %d → %d", (input, expected) => {
    expect(parseMonthlyMileage(input)).toBe(expected);
  });

  it.each(["1000", "2000", "3000"])("parses canonical numeric string %s", (s) => {
    expect(parseMonthlyMileage(s)).toBe(Number(s));
  });

  it.each([null, undefined, ""])("returns null for empty input %s", (v) => {
    expect(parseMonthlyMileage(v)).toBeNull();
  });

  it.each(["abc", "4k_kms", 5, 42, "0"])("returns null for unknown %s", (v) => {
    expect(parseMonthlyMileage(v)).toBeNull();
  });
});
