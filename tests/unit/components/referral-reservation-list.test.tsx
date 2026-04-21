import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
  ReferralReservationList,
  type ReferralReservationRow,
} from "@/app/(dashboard)/referrals/[id]/reservation-list";

const baseRow: ReferralReservationRow = {
  id: "res-1",
  created_at: "2026-04-16T14:43:00.000Z",
  reservation_code: "AV6OXGXGP",
  status: "reservado",
  franchise: "alquilame",
  pickup_date: "2026-04-20",
  pickup_hour: "12:00:00",
  total_price: 150000,
  tax_fee: 14278,
  customer_name: "Juan Pérez",
};

afterEach(() => {
  cleanup();
});

describe("ReferralReservationList", () => {
  it("renders empty state when rows is empty", () => {
    render(<ReferralReservationList rows={[]} />);
    expect(
      screen.getByText(/este referido no tiene reservas asociadas/i),
    ).toBeTruthy();
  });

  it("renders one row per reservation with a link to the detail page", () => {
    const { container } = render(
      <ReferralReservationList rows={[baseRow]} />,
    );
    const link = container.querySelector(
      `a[href="/reservations/${baseRow.id}"]`,
    );
    expect(link).not.toBeNull();
    expect(container.textContent).toContain("AV6OXGXGP");
  });

  it("renders the customer name column", () => {
    render(<ReferralReservationList rows={[baseRow]} />);
    expect(screen.getByText("Juan Pérez")).toBeTruthy();
  });

  it("renders the status label in Spanish", () => {
    render(<ReferralReservationList rows={[baseRow]} />);
    expect(screen.getByText("Reservado")).toBeTruthy();
  });

  it("sums total_price + tax_fee for the total column", () => {
    render(<ReferralReservationList rows={[baseRow]} />);
    expect(screen.getByText(/164\.278/)).toBeTruthy();
  });

  it("renders pluralised count", () => {
    render(
      <ReferralReservationList rows={[baseRow, { ...baseRow, id: "r2" }]} />,
    );
    expect(screen.getByText("2 reservas")).toBeTruthy();
  });

  it("renders singular count when rows.length === 1", () => {
    render(<ReferralReservationList rows={[baseRow]} />);
    expect(screen.getByText("1 reserva")).toBeTruthy();
  });

  it("falls back to dash when customer_name is null", () => {
    render(
      <ReferralReservationList
        rows={[{ ...baseRow, customer_name: null }]}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("falls back to dash when reservation_code is null", () => {
    render(
      <ReferralReservationList
        rows={[{ ...baseRow, reservation_code: null }]}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });
});
