import { describe, it, expect } from "vitest";
import {
  splitVehicleName,
  formatIncludedFees,
  formatExtras,
  pickVehicleImage,
} from "@/lib/reservation/libro-helpers";

describe("splitVehicleName", () => {
  it("splits 'Gama F Sedán Mecánico' into 2 lines", () => {
    expect(splitVehicleName("Gama F Sedán Mecánico")).toEqual([
      "Gama F",
      "Sedán Mecánico",
    ]);
  });

  it("keeps first 2 words on line 1, rest on line 2", () => {
    expect(splitVehicleName("Gama K Camioneta Pickup Automática")).toEqual([
      "Gama K",
      "Camioneta Pickup Automática",
    ]);
  });

  it("falls back to single line when the name has <= 2 words", () => {
    expect(splitVehicleName("Gama F")).toEqual(["Gama F", ""]);
    expect(splitVehicleName("")).toEqual(["", ""]);
  });
});

describe("formatIncludedFees", () => {
  it("monthly + total insurance → 'Kilometraje: X, Seguro total'", () => {
    expect(
      formatIncludedFees({
        selected_days: 30,
        total_insurance: 150000,
        monthly_mileage: 2000,
      }),
    ).toBe("Kilometraje: 2000, Seguro total");
  });

  it("monthly + basic insurance → 'Kilometraje: X, Seguro básico'", () => {
    expect(
      formatIncludedFees({
        selected_days: 30,
        total_insurance: 0,
        monthly_mileage: 1000,
      }),
    ).toBe("Kilometraje: 1000, Seguro básico");
  });

  it("standard + total insurance → 'Kilometraje ilimitado, Seguro total'", () => {
    expect(
      formatIncludedFees({
        selected_days: 3,
        total_insurance: 80000,
        monthly_mileage: null,
      }),
    ).toBe("Kilometraje ilimitado, Seguro total");
  });

  it("standard + basic insurance → 'Kilometraje ilimitado, Seguro básico'", () => {
    expect(
      formatIncludedFees({
        selected_days: 2,
        total_insurance: 0,
        monthly_mileage: null,
      }),
    ).toBe("Kilometraje ilimitado, Seguro básico");
  });
});

describe("pickVehicleImage", () => {
  const cat = { image_url: "cat.png" };

  it("returns the default active model image when present", () => {
    const img = pickVehicleImage(cat, [
      { image_url: "m1.png", is_default: false, status: "active" },
      { image_url: "def.png", is_default: true, status: "active" },
    ]);
    expect(img).toBe("def.png");
  });

  it("ignores inactive models when picking default", () => {
    const img = pickVehicleImage(cat, [
      { image_url: "inactive.png", is_default: true, status: "inactive" },
      { image_url: "first.png", is_default: false, status: "active" },
    ]);
    expect(img).toBe("first.png");
  });

  it("falls back to the first active model when no default", () => {
    const img = pickVehicleImage(cat, [
      { image_url: "a.png", is_default: false, status: "active" },
      { image_url: "b.png", is_default: false, status: "active" },
    ]);
    expect(img).toBe("a.png");
  });

  it("falls back to category image when no models exist", () => {
    expect(pickVehicleImage({ image_url: "cat.png" }, [])).toBe("cat.png");
  });

  it("skips models with empty image_url", () => {
    const img = pickVehicleImage(cat, [
      { image_url: "", is_default: true, status: "active" },
      { image_url: "m2.png", is_default: false, status: "active" },
    ]);
    expect(img).toBe("m2.png");
  });

  it("returns null when no image is available anywhere", () => {
    expect(
      pickVehicleImage({ image_url: "" }, [
        { image_url: "", is_default: true, status: "active" },
      ]),
    ).toBeNull();
  });

  it("accepts null category and null model list", () => {
    expect(pickVehicleImage(null, null)).toBeNull();
  });
});

describe("formatExtras", () => {
  it("returns Spanish labels for selected flags", () => {
    expect(
      formatExtras({ baby_seat: true, wash: false, extra_driver: true }),
    ).toEqual(["Silla de Bebé", "Conductor Adicional"]);
  });

  it("returns empty list when no flags set", () => {
    expect(
      formatExtras({ baby_seat: false, wash: false, extra_driver: false }),
    ).toEqual([]);
  });

  it("includes 'Lavado' when wash is true", () => {
    expect(
      formatExtras({ baby_seat: false, wash: true, extra_driver: false }),
    ).toEqual(["Lavado"]);
  });
});
