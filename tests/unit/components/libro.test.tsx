import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Libro } from "@/app/(print)/reservations/[id]/libro/libro";

type LibroProps = ComponentProps<typeof Libro>;

const baseReservation: LibroProps["reservation"] = {
  id: "res-1",
  franchise: "alquilame",
  reservation_code: "AV6OXGXGP",
  pickup_date: "2026-04-20",
  pickup_hour: "12:00:00",
  return_date: "2026-04-25",
  return_hour: "10:00:00",
  selected_days: 5,
  total_price_to_pay: 150000,
  total_insurance: false,
  monthly_mileage: null,
  extra_hours_price: 0,
  return_fee: 0,
  baby_seat: false,
  wash: false,
  extra_driver: false,
  customers: { first_name: "Juan", last_name: "Pérez" },
  pickup_location: {
    name: "Sede Centro",
    pickup_address: "Calle 1 # 2-3",
    return_address: null,
    city: "Bogotá",
  },
  return_location: null,
  rental_companies: { name: "Localiza" },
};

const category: LibroProps["category"] = { name: "Grupo A", image_url: null };

function renderLibro(overrides: Partial<LibroProps["reservation"]> = {}) {
  return render(
    <Libro
      reservation={{ ...baseReservation, ...overrides }}
      category={category}
      models={null}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("Libro — Titular autorizado", () => {
  it("SCEN-001: muestra el nombre del cliente bajo la etiqueta 'Titular autorizado'", () => {
    renderLibro();
    expect(screen.getByText(/Titular autorizado/i)).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
  });

  it("SCEN-001: 'Titular autorizado' aparece encima de 'Fecha recogida' en el DOM", () => {
    renderLibro();
    const titular = screen.getByText(/Titular autorizado/i);
    const fecha = screen.getByText(/Fecha recogida/i);
    // node anterior en orden de documento => compareDocumentPosition contiene FOLLOWING
    expect(
      titular.compareDocumentPosition(fecha) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("SCEN-002: sin cliente asociado muestra '—' y no rompe la vista", () => {
    renderLibro({ customers: null });
    const titular = screen.getByText(/Titular autorizado/i);
    const row = titular.parentElement;
    expect(row?.textContent).toContain("—");
  });
});
