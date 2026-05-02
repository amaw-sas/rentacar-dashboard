import { describe, it, expect } from "vitest";
import { matchesCity, ALL_CITIES } from "@/app/(dashboard)/reservations/reservations-table";
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
