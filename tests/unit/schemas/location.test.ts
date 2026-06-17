import { describe, it, expect } from "vitest";
import {
  locationSchema,
  locationScheduleSchema,
  type LocationSchedule,
} from "@/lib/schemas/location";

describe("locationSchema", () => {
  const valid = {
    rental_company_id: "550e8400-e29b-41d4-a716-446655440000",
    code: "AABOT",
    name: "Bogotá Aeropuerto",
    city: "",
    city_id: "650e8400-e29b-41d4-a716-446655440111",
    pickup_address: "Aeropuerto El Dorado, Piso 1 Puerta 7",
    pickup_map: "https://maps.app.goo.gl/abc",
    schedule: { mon: ["08:00-18:00"] },
    slug: "bogota-aeropuerto",
    status: "active" as const,
  };

  it("accepts valid location data", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts optional return_address and return_map", () => {
    const result = locationSchema.safeParse({
      ...valid,
      return_address: "Av Otro Lugar",
      return_map: "https://maps.app.goo.gl/xyz",
    });
    expect(result.success).toBe(true);
  });

  it("requires rental_company_id as uuid", () => {
    const result = locationSchema.safeParse({ ...valid, rental_company_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("requires code", () => {
    const result = locationSchema.safeParse({ ...valid, code: "" });
    expect(result.success).toBe(false);
  });

  it("requires name", () => {
    const result = locationSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
  });

  it("requires non-empty pickup_address", () => {
    const result = locationSchema.safeParse({ ...valid, pickup_address: "" });
    expect(result.success).toBe(false);
  });

  it("requires non-empty pickup_map", () => {
    const result = locationSchema.safeParse({ ...valid, pickup_map: "" });
    expect(result.success).toBe(false);
  });

  it("defaults return fields to null", () => {
    const result = locationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.return_address).toBeNull();
      expect(result.data.return_map).toBeNull();
      expect(result.data.status).toBe("active");
    }
  });

  it("requires city_id as uuid — city is now resolved via the cities catalog", () => {
    const result = locationSchema.safeParse({ ...valid, city_id: null });
    expect(result.success).toBe(false);
  });

  it("rejects empty string for city_id", () => {
    const result = locationSchema.safeParse({ ...valid, city_id: "" });
    expect(result.success).toBe(false);
  });

  // SCEN-008: the location form has no schedule field, so the server action
  // relies on the schema default {} when `schedule` is absent.
  it("defaults schedule to {} when absent", () => {
    const withoutSchedule: Record<string, unknown> = { ...valid };
    delete withoutSchedule.schedule;
    const result = locationSchema.safeParse(withoutSchedule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schedule).toEqual({});
    }
  });
});

describe("locationScheduleSchema (issue #95 — structured schedule v2)", () => {
  // SCEN-001 / AC-D1.1
  it("accepts a typical week with an empty (closed) holiday", () => {
    const result = locationScheduleSchema.safeParse({
      mon: ["08:00-18:00"],
      sat: ["08:00-13:00"],
      hol: [],
    });
    expect(result.success).toBe(true);
  });

  // SCEN-002 / AC-D1.2
  it("rejects a minute boundary off the 30-minute grid", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["08:15-18:00"] });
    expect(result.success).toBe(false);
  });

  // SCEN-003 / AC-D1.3
  it("rejects an inverted range (start after end)", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["18:00-08:00"] });
    expect(result.success).toBe(false);
  });

  // SCEN-004 / AC-D1.4
  it("accepts an empty object (permissive)", () => {
    const result = locationScheduleSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  // SCEN-005 / AC-D1.5
  it("accepts display and structured days coexisting", () => {
    const result = locationScheduleSchema.safeParse({
      display: "Lun-Vie 06:00-19:00",
      mon: ["08:00-18:00"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display).toBe("Lun-Vie 06:00-19:00");
    }
  });

  // SCEN-006 / AC-D1.6
  it("accepts the 24-hour sentinel 00:00-24:00", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["00:00-24:00"] });
    expect(result.success).toBe(true);
  });

  // SCEN-007 / AC-D1.7
  it("rejects the degenerate 24:00-24:00 range", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["24:00-24:00"] });
    expect(result.success).toBe(false);
  });

  it("rejects 23:30-24:30 (end exceeds the 24:00 sentinel)", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["23:30-24:30"] });
    expect(result.success).toBe(false);
  });

  // Locks the `startMin < endMin` strictness against an accidental `<=`
  // relaxation: a zero-length range would otherwise leak a 0-minute window.
  it("rejects a zero-length range (start equals end)", () => {
    const result = locationScheduleSchema.safeParse({ mon: ["08:00-08:00"] });
    expect(result.success).toBe(false);
  });

  // A misspelled/locale day key must fail loudly, not be silently stripped to
  // "closed" — `.strict()` enforces this.
  it("rejects an unknown/misspelled day key", () => {
    expect(locationScheduleSchema.safeParse({ monday: ["08:00-18:00"] }).success).toBe(false);
    expect(locationScheduleSchema.safeParse({ lun: ["08:00-18:00"] }).success).toBe(false);
  });

  it("exposes the LocationSchedule type", () => {
    const value: LocationSchedule = { mon: ["08:00-18:00"], hol: [] };
    expect(locationScheduleSchema.safeParse(value).success).toBe(true);
  });
});
