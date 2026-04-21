import { describe, it, expect } from "vitest";
import {
  reservationSchema,
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  PRIORITY_STATUSES,
  isPriorityStatus,
  MONTHLY_MILEAGE_OPTIONS,
} from "@/lib/schemas/reservation";

describe("reservationSchema", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const valid = {
    customer_id: uuid,
    rental_company_id: uuid,
    pickup_location_id: uuid,
    return_location_id: uuid,
    franchise: "alquilatucarro" as const,
    booking_type: "standard" as const,
    category_code: "ECON",
    pickup_date: "2026-04-01",
    pickup_hour: "09:00",
    return_date: "2026-04-05",
    return_hour: "09:00",
    selected_days: 4,
    total_price: 400000,
    total_price_to_pay: 476000,
  };

  it("accepts valid reservation data", () => {
    const result = reservationSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires customer_id as uuid", () => {
    const result = reservationSchema.safeParse({ ...valid, customer_id: "bad" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid franchise", () => {
    const result = reservationSchema.safeParse({ ...valid, franchise: "hertz" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid franchises", () => {
    for (const f of ["alquilatucarro", "alquilame", "alquicarros"]) {
      const result = reservationSchema.safeParse({ ...valid, franchise: f });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid booking_type", () => {
    const result = reservationSchema.safeParse({ ...valid, booking_type: "lease" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid booking types", () => {
    for (const bt of ["standard", "standard_with_insurance", "monthly"]) {
      const result = reservationSchema.safeParse({ ...valid, booking_type: bt });
      expect(result.success).toBe(true);
    }
  });

  it("allows nullable reservation_code for monthly", () => {
    const result = reservationSchema.safeParse({
      ...valid,
      booking_type: "monthly",
      reservation_code: null,
      reference_token: null,
      rate_qualifier: null,
    });
    expect(result.success).toBe(true);
  });

  it("allows referral_raw as fallback", () => {
    const result = reservationSchema.safeParse({
      ...valid,
      referral_id: null,
      referral_raw: "hotel-desconocido",
    });
    expect(result.success).toBe(true);
  });

  it("defaults numeric fields to 0", () => {
    const result = reservationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.return_fee).toBe(0);
      expect(result.data.extra_hours).toBe(0);
      expect(result.data.total_insurance).toBe(0);
    }
  });

  it("defaults boolean extras to false", () => {
    const result = reservationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extra_driver).toBe(false);
      expect(result.data.baby_seat).toBe(false);
      expect(result.data.wash).toBe(false);
    }
  });

  it("defaults status to nueva", () => {
    const result = reservationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("nueva");
    }
  });

  it("has 13 reservation statuses", () => {
    expect(RESERVATION_STATUSES).toHaveLength(13);
  });

  it("defaults nota to null when omitted", () => {
    const result = reservationSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nota).toBeNull();
    }
  });

  it("accepts nota as a string", () => {
    const result = reservationSchema.safeParse({ ...valid, nota: "cliente llega tarde" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nota).toBe("cliente llega tarde");
    }
  });

  it("accepts nota as null", () => {
    const result = reservationSchema.safeParse({ ...valid, nota: null });
    expect(result.success).toBe(true);
  });

  const MONEY_FIELDS = [
    "total_price",
    "total_price_to_pay",
    "total_price_localiza",
    "tax_fee",
    "iva_fee",
    "coverage_price",
    "return_fee",
    "extra_hours_price",
    "total_insurance",
  ] as const;

  it.each(MONEY_FIELDS)("accepts decimal %s (DB column is numeric(12,2))", (field) => {
    const result = reservationSchema.safeParse({ ...valid, [field]: 150.5 });
    expect(result.success).toBe(true);
  });

  it.each(MONEY_FIELDS)("accepts integer %s", (field) => {
    const result = reservationSchema.safeParse({ ...valid, [field]: 150000 });
    expect(result.success).toBe(true);
  });

  it.each(MONEY_FIELDS)("rejects negative %s", (field) => {
    const result = reservationSchema.safeParse({ ...valid, [field]: -1 });
    expect(result.success).toBe(false);
  });

  it("exposes monthly mileage options mirroring the legacy 1k/2k/3k enum", () => {
    expect(MONTHLY_MILEAGE_OPTIONS.map((o) => o.value)).toEqual([1000, 2000, 3000]);
    expect(MONTHLY_MILEAGE_OPTIONS.map((o) => o.label)).toEqual([
      "1.000 km",
      "2.000 km",
      "3.000 km",
    ]);
  });
});

describe("VALID_TRANSITIONS", () => {
  it("allows pendiente → reservado", () => {
    expect(VALID_TRANSITIONS.pendiente).toContain("reservado");
  });

  it("allows pendiente → sin_disponibilidad", () => {
    expect(VALID_TRANSITIONS.pendiente).toContain("sin_disponibilidad");
  });

  it("allows mensualidad → reservado", () => {
    expect(VALID_TRANSITIONS.mensualidad).toContain("reservado");
  });

  it("does not allow reservado → pendiente", () => {
    expect(VALID_TRANSITIONS.reservado).not.toContain("pendiente");
  });

  it("allows most statuses to transition to cancelado", () => {
    const statuses = Object.keys(VALID_TRANSITIONS).filter((s) => s !== "cancelado");
    for (const status of statuses) {
      expect(VALID_TRANSITIONS[status as keyof typeof VALID_TRANSITIONS]).toContain("cancelado");
    }
  });

  it("cancelado has no outgoing transitions", () => {
    expect(VALID_TRANSITIONS.cancelado).toHaveLength(0);
  });
});

describe("PRIORITY_STATUSES", () => {
  it("contains exactly pendiente, pendiente_modificar, mensualidad, pendiente_pago", () => {
    expect([...PRIORITY_STATUSES]).toEqual([
      "pendiente",
      "pendiente_modificar",
      "mensualidad",
      "pendiente_pago",
    ]);
  });

  it("isPriorityStatus returns true for priority statuses", () => {
    expect(isPriorityStatus("pendiente")).toBe(true);
    expect(isPriorityStatus("pendiente_modificar")).toBe(true);
    expect(isPriorityStatus("mensualidad")).toBe(true);
    expect(isPriorityStatus("pendiente_pago")).toBe(true);
  });

  it("isPriorityStatus returns false for non-priority statuses", () => {
    expect(isPriorityStatus("nueva")).toBe(false);
    expect(isPriorityStatus("reservado")).toBe(false);
    expect(isPriorityStatus("utilizado")).toBe(false);
    expect(isPriorityStatus("cancelado")).toBe(false);
    expect(isPriorityStatus("indeterminado")).toBe(false);
    expect(isPriorityStatus("")).toBe(false);
  });
});
