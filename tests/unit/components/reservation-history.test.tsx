import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
  ReservationHistory,
  type HistoryRow,
} from "@/app/(dashboard)/customers/[id]/reservation-history";

const baseRow: HistoryRow = {
  id: "res-1",
  created_at: "2026-04-16T14:43:00.000Z",
  reservation_code: "AV6OXGXGP",
  status: "reservado",
  franchise: "alquilame",
  pickup_date: "2026-04-20",
  pickup_hour: "12:00:00",
  total_price: 150000,
  tax_fee: 14278,
};

afterEach(() => {
  cleanup();
});

describe("ReservationHistory", () => {
  it("renders empty state when rows is empty", () => {
    render(<ReservationHistory rows={[]} />);
    expect(
      screen.getByText(/este cliente no tiene reservas aún/i),
    ).toBeTruthy();
  });

  it("renders one row per reservation with a link to the detail page", () => {
    const { container } = render(<ReservationHistory rows={[baseRow]} />);
    const link = container.querySelector(`a[href="/reservations/${baseRow.id}"]`);
    expect(link).not.toBeNull();
    expect(container.textContent).toContain("AV6OXGXGP");
  });

  it("renders the status label in Spanish", () => {
    render(<ReservationHistory rows={[baseRow]} />);
    expect(screen.getByText("Reservado")).toBeTruthy();
  });

  it("sums total_price + tax_fee for the total column", () => {
    render(<ReservationHistory rows={[baseRow]} />);
    // 150000 + 14278 = 164278 → "$ 164.278" (es-CO)
    expect(screen.getByText(/164\.278/)).toBeTruthy();
  });

  it("renders pluralised count", () => {
    render(<ReservationHistory rows={[baseRow, { ...baseRow, id: "r2" }]} />);
    expect(screen.getByText("2 reservas")).toBeTruthy();
  });

  it("renders singular count when rows.length === 1", () => {
    render(<ReservationHistory rows={[baseRow]} />);
    expect(screen.getByText("1 reserva")).toBeTruthy();
  });

  it("falls back to dash when reservation_code is null", () => {
    render(
      <ReservationHistory rows={[{ ...baseRow, reservation_code: null }]} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });
});
