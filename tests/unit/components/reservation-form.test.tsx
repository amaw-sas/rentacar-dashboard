import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReservationForm } from "@/components/forms/reservation-form";

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/reservations", () => ({
  createReservation: vi.fn(),
  updateReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const customers = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    first_name: "Daniela",
    last_name: "Carreño",
    identification_type: "CC",
    identification_number: "1007489090",
    phone: "+57 312 4366514",
    email: "dc005241@gmail.com",
  },
];

const rentalCompanies = [
  { id: "22222222-2222-2222-2222-222222222222", name: "Localiza" },
];

const locations = [
  { id: "33333333-3333-3333-3333-333333333333", name: "Manizales Mall Plaza" },
];

const referrals = [
  { id: "44444444-4444-4444-4444-444444444444", name: "Daniela", code: "REF1" },
];

function renderForm(extra?: { id?: string; defaultStatus?: string }) {
  return render(
    <ReservationForm
      id={extra?.id}
      defaultValues={
        extra?.defaultStatus
          ? ({ status: extra.defaultStatus } as Parameters<typeof ReservationForm>[0]["defaultValues"])
          : undefined
      }
      customers={customers}
      rentalCompanies={rentalCompanies}
      locations={locations}
      referrals={referrals}
    />,
  );
}

describe("ReservationForm layout", () => {
  afterEach(() => cleanup());

  it("renders cards in the operator-expected order", () => {
    renderForm();
    const titles = Array.from(document.querySelectorAll('[data-slot="card-title"]'))
      .map((el) => el.textContent?.trim());
    expect(titles).toEqual([
      "Cliente",
      "Vehículo",
      "Precios",
      "Recogida y Retorno",
      "Reserva",
      "Operación",
      "Adicionales",
      "Vuelo",
      "Datos adicionales",
      "Nota",
    ]);
  });

  it("shows the legacy labels for priority fields", () => {
    renderForm();
    expect(screen.getByLabelText("Precio sin IVA con tasa")).toBeInTheDocument();
    expect(screen.getByLabelText("Precio total a pagar")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor OC")).toBeInTheDocument();
    expect(screen.getByLabelText("Día recogida")).toBeInTheDocument();
    expect(screen.getByLabelText("Día retorno")).toBeInTheDocument();
    expect(screen.getByLabelText("Días reservados")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de reserva")).toBeInTheDocument();
    expect(screen.getByLabelText("Número de vuelo")).toBeInTheDocument();
    expect(screen.getByLabelText("Silla bebé")).toBeInTheDocument();
  });

  it("omits Estado select inside Operación card — status is managed via transition buttons", () => {
    renderForm();
    const operacionCard = Array.from(document.querySelectorAll('[data-slot="card"]')).find(
      (el) => el.querySelector('[data-slot="card-title"]')?.textContent?.trim() === "Operación",
    );
    expect(operacionCard).toBeTruthy();
    expect(operacionCard!.textContent).not.toContain("Estado");
  });

  it("does not render the Estado card when creating a new reservation", () => {
    renderForm();
    expect(screen.queryByText("Estado actual:")).toBeNull();
  });

  it("renders the Estado card with status transition buttons when editing", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultStatus: "nueva",
    });
    const titles = Array.from(document.querySelectorAll('[data-slot="card-title"]'))
      .map((el) => el.textContent?.trim());
    expect(titles).toContain("Estado");
    expect(screen.getByText("Estado actual:")).toBeInTheDocument();
    // VALID_TRANSITIONS["nueva"] → pendiente, reservado, sin_disponibilidad, mensualidad, cancelado
    expect(screen.getByRole("button", { name: "Pendiente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reservado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelado" })).toBeInTheDocument();
  });

  it("hides technical fields from operators", () => {
    renderForm();
    expect(screen.queryByLabelText("Token de referencia")).toBeNull();
    expect(screen.queryByLabelText("Calificador tarifa")).toBeNull();
    expect(document.querySelector('input[name="reference_token"]')).toHaveAttribute(
      "type",
      "hidden",
    );
    expect(document.querySelector('input[name="rate_qualifier"]')).toHaveAttribute(
      "type",
      "hidden",
    );
  });

  it("renders the customer preview as read-only", () => {
    renderForm();
    const nombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    const tipoId = screen.getByLabelText("Tipo identificación") as HTMLInputElement;
    const identificacion = screen.getByLabelText("Identificación") as HTMLInputElement;
    const telefono = screen.getByLabelText("Teléfono") as HTMLInputElement;
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    for (const input of [nombre, tipoId, identificacion, telefono, email]) {
      expect(input).toHaveAttribute("readOnly");
    }
  });

  it("pairs small cards in a 2-column grid on large viewports", () => {
    renderForm();
    const pairedGroups = Array.from(
      document.querySelectorAll("form > div.grid.lg\\:grid-cols-2"),
    );
    expect(pairedGroups.length).toBeGreaterThanOrEqual(3);
    const titlesInGroup = (idx: number) =>
      Array.from(pairedGroups[idx].querySelectorAll('[data-slot="card-title"]')).map(
        (el) => el.textContent?.trim(),
      );
    expect(titlesInGroup(0)).toEqual(["Vehículo", "Precios"]);
    expect(titlesInGroup(1)).toEqual(["Reserva", "Operación"]);
    expect(titlesInGroup(2)).toEqual(["Adicionales", "Vuelo"]);
  });
});
