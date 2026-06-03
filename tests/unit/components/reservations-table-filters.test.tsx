import { describe, it, expect } from "vitest";
import {
  matchesCity,
  matchesSearch,
  ALL_CITIES,
} from "@/app/(dashboard)/reservations/reservations-table";
import type { ReservationRow } from "@/app/(dashboard)/reservations/columns";

const baseRow: ReservationRow = {
  id: "res-1",
  franchise: "alquilame",
  booking_type: "standard",
  category_code: "C",
  pickup_date: "2026-04-20",
  pickup_hour: "12:00:00",
  created_at: "2026-04-16T14:43:00.000Z",
  status: "reservado",
  reservation_code: "AV6OXGXGP",
  total_price: 150000,
  tax_fee: 14278,
  total_price_localiza: 0,
  referral_id: null,
  referral_raw: null,
  customers: {
    first_name: "Daniela",
    last_name: "Carreño",
    identification_number: "1007489090",
    phone: "+57 312 4366514",
    email: "dc005241@gmail.com",
  },
  rental_companies: { name: "Localiza" },
  pickup_location: {
    name: "Aeropuerto BOG",
    city_id: "city-bog",
    cities: { id: "city-bog", name: "Bogotá" },
  },
  return_location: { name: "Aeropuerto" },
  referrals: { id: "ref-1", name: "Daniela", code: "DAN" },
};

describe("matchesCity predicate", () => {
  it("returns true for ALL_CITIES regardless of pickup city", () => {
    expect(matchesCity(baseRow, ALL_CITIES)).toBe(true);
  });

  it("returns true when pickup_location.city_id equals filter", () => {
    expect(matchesCity(baseRow, "city-bog")).toBe(true);
  });

  it("returns false when pickup_location.city_id differs", () => {
    expect(matchesCity(baseRow, "city-mde")).toBe(false);
  });

  it("returns false when pickup_location is null and a city is selected", () => {
    const row: ReservationRow = { ...baseRow, pickup_location: null };
    expect(matchesCity(row, "city-bog")).toBe(false);
  });

  it("returns true when pickup_location is null and ALL_CITIES is selected", () => {
    const row: ReservationRow = { ...baseRow, pickup_location: null };
    expect(matchesCity(row, ALL_CITIES)).toBe(true);
  });

  it("returns false when pickup_location.city_id is null and a city is selected", () => {
    const row: ReservationRow = {
      ...baseRow,
      pickup_location: { name: "Sin ciudad", city_id: null, cities: null },
    };
    expect(matchesCity(row, "city-bog")).toBe(false);
  });
});

// SCEN-001 (search divergence): search must key off the booking-time snapshot,
// not the live join. After a global edit "Jose"→"test90", the row still DISPLAYS
// "Jose" (snapshot), so searching "Jose" must find it; searching "test90" (a
// value shown nowhere on this row) must NOT match. Otherwise the operator cannot
// find a reservation by the identity the UI shows them.
describe("matchesSearch predicate — snapshot-aware (issue #26)", () => {
  // Row whose snapshot froze "Jose" while the live customer was later edited to
  // "test90". Same divergence for id/email/phone.
  const frozenRow: ReservationRow = {
    ...baseRow,
    customer_name_at_booking: "Jose Perez",
    customer_identification_number_at_booking: "111111",
    customer_email_at_booking: "jose@example.com",
    customer_phone_at_booking: "+57 300 1110000",
    customers: {
      first_name: "test90",
      last_name: "X",
      identification_number: "999999",
      phone: "+57 300 9999999",
      email: "test90@example.com",
    },
  };

  it("matches the booking-time name shown in the UI", () => {
    expect(matchesSearch(frozenRow, "jose")).toBe(true);
  });

  it("does NOT match the live (post-edit) name that is shown nowhere on the row", () => {
    expect(matchesSearch(frozenRow, "test90")).toBe(false);
  });

  it("matches the booking-time identification, email and phone", () => {
    expect(matchesSearch(frozenRow, "111111")).toBe(true);
    expect(matchesSearch(frozenRow, "jose@example.com")).toBe(true);
    expect(matchesSearch(frozenRow, "1110000")).toBe(true);
  });

  it("does NOT match the live identification/email shown nowhere on the row", () => {
    expect(matchesSearch(frozenRow, "999999")).toBe(false);
    expect(matchesSearch(frozenRow, "test90@example.com")).toBe(false);
  });

  it("falls back to the live join when no snapshot is present (defensive)", () => {
    // A row with no snapshot (theoretical — columns are NOT NULL in prod) must
    // still be searchable by its live join values.
    expect(matchesSearch(baseRow, "daniela")).toBe(true);
    expect(matchesSearch(baseRow, "1007489090")).toBe(true);
  });

  it("still matches the reservation_code regardless of snapshot", () => {
    expect(matchesSearch(frozenRow, "av6oxgxgp")).toBe(true);
  });
});
