import { describe, it, expect } from "vitest";
import { computeLocalizaFinances } from "@/lib/calculations/reservation-finances";

describe("computeLocalizaFinances", () => {
  it("matches legacy PHP trait output for total 245.000", () => {
    const r = computeLocalizaFinances(245000);
    expect(r.iva).toBe(39118);
    expect(r.tax).toBe(18717);
    expect(r.subtotal).toBe(187165);
    expect(r.tarifa).toBe(187165);
    expect(r.total).toBe(245000);
  });

  it("subtracts return_fee and extra_hours_price from tarifa", () => {
    const r = computeLocalizaFinances(245000, 10000, 5000);
    expect(r.subtotal).toBe(187165);
    expect(r.tarifa).toBe(187165 - 10000 - 5000);
  });

  it("returns zeros when total is 0", () => {
    const r = computeLocalizaFinances(0);
    expect(r.total).toBe(0);
    expect(r.iva).toBe(0);
    expect(r.tax).toBe(0);
    expect(r.subtotal).toBe(0);
    expect(r.tarifa).toBe(0);
  });
});
