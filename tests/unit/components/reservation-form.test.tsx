import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ReservationForm } from "@/components/forms/reservation-form";

const { refreshSpy, updateCustomerContactSpy } = vi.hoisted(() => ({
  refreshSpy: vi.fn(),
  updateCustomerContactSpy: vi.fn(),
}));

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
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: refreshSpy }),
}));

vi.mock("@/lib/actions/reservations", () => ({
  createReservation: vi.fn(),
  updateReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
}));

vi.mock("@/lib/actions/customers", () => ({
  updateCustomerContact: updateCustomerContactSpy,
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

const vehicleCategories = [
  {
    id: "55555555-5555-5555-5555-555555555555",
    code: "ECON",
    name: "Económico",
    rental_company_id: "22222222-2222-2222-2222-222222222222",
    status: "active",
  },
  {
    id: "66666666-6666-6666-6666-666666666666",
    code: "SUV",
    name: "SUV Mediana",
    rental_company_id: "22222222-2222-2222-2222-222222222222",
    status: "active",
  },
];

function renderForm(extra?: {
  id?: string;
  defaultStatus?: string;
  defaultValues?: Parameters<typeof ReservationForm>[0]["defaultValues"];
}) {
  const merged =
    extra?.defaultValues ??
    (extra?.defaultStatus
      ? ({ status: extra.defaultStatus } as Parameters<typeof ReservationForm>[0]["defaultValues"])
      : undefined);
  return render(
    <ReservationForm
      id={extra?.id}
      defaultValues={merged}
      customers={customers}
      rentalCompanies={rentalCompanies}
      locations={locations}
      referrals={referrals}
      vehicleCategories={vehicleCategories}
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
    // Free transition graph: from "nueva" we should see one button per other status.
    expect(screen.getByRole("button", { name: "Pendiente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reservado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Utilizado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baneado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nueva" })).toBeNull();
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

  // Status must NOT travel through the form payload — it is owned exclusively
  // by ReservationStatusActions. A stale hidden input would overwrite a
  // freshly-changed status on form submit (issue #10).
  it("does not expose status as a form input", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultStatus: "nueva",
    });
    expect(document.querySelector('input[name="status"]')).toBeNull();
    expect(document.querySelector('select[name="status"]')).toBeNull();
  });

  // #36: customer contact fields are editable inline (no longer read-only).
  // SCEN-005: with no customer selected, the fields and the "Guardar cliente"
  // button are disabled — the action cannot run without a customer id.
  it("disables customer contact editing when no customer is selected", () => {
    renderForm();
    const nombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    const apellido = screen.getByLabelText("Apellido") as HTMLInputElement;
    const identificacion = screen.getByLabelText(
      "Identificación",
    ) as HTMLInputElement;
    const telefono = screen.getByLabelText("Teléfono") as HTMLInputElement;
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    for (const input of [nombre, apellido, identificacion, telefono, email]) {
      expect(input).not.toHaveAttribute("readOnly");
      expect(input).toBeDisabled();
    }
    expect(
      screen.getByRole("button", { name: "Guardar cliente" }),
    ).toBeDisabled();
  });

  // SCEN-007 base: when a customer is selected the fields are editable and
  // seeded from the persisted record; the button stays disabled until the
  // operator actually changes something (draft == snapshot, not dirty).
  it("enables and seeds customer contact fields when a customer is selected", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        customer_id: customers[0].id,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const nombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    const apellido = screen.getByLabelText("Apellido") as HTMLInputElement;
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(nombre).toBeEnabled();
    expect(nombre).not.toHaveAttribute("readOnly");
    expect(nombre.value).toBe("Daniela");
    expect(apellido.value).toBe("Carreño");
    expect(email.value).toBe("dc005241@gmail.com");
    // Not dirty yet → save disabled.
    expect(
      screen.getByRole("button", { name: "Guardar cliente" }),
    ).toBeDisabled();
  });

  // SCEN-007: editing a field enables "Guardar cliente"; reverting to the
  // exact persisted value disables it again (draft vs snapshot).
  it("toggles the save button on dirty / revert", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        customer_id: customers[0].id,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const button = screen.getByRole("button", { name: "Guardar cliente" });

    expect(button).toBeDisabled();
    fireEvent.change(email, { target: { value: "nuevo@mail.com" } });
    expect(button).toBeEnabled();
    // Revert to the exact original value → not dirty again.
    fireEvent.change(email, { target: { value: "dc005241@gmail.com" } });
    expect(button).toBeDisabled();
  });

  // SCEN-001: a successful save resets dirty, shows the saved value, and
  // calls router.refresh() to resync the combobox — without resubmitting
  // the reservation.
  it("persists the contact edit, resets dirty, and refreshes", async () => {
    updateCustomerContactSpy.mockResolvedValueOnce({});
    refreshSpy.mockClear();
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        customer_id: customers[0].id,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const button = screen.getByRole("button", { name: "Guardar cliente" });

    fireEvent.change(email, { target: { value: "nuevo@mail.com" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(updateCustomerContactSpy).toHaveBeenCalledTimes(1);
    });
    const [calledId, calledFd] = updateCustomerContactSpy.mock.calls[0];
    expect(calledId).toBe(customers[0].id);
    expect((calledFd as FormData).get("email")).toBe("nuevo@mail.com");

    await waitFor(() => {
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
    // Dirty reset: button disabled again, field shows the saved value.
    expect(button).toBeDisabled();
    expect(email.value).toBe("nuevo@mail.com");
  });

  // SCEN-003: invalid email blocks the save — the action is never called
  // and an inline error is shown.
  it("blocks save on invalid email without calling the action", async () => {
    updateCustomerContactSpy.mockClear();
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        customer_id: customers[0].id,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    const button = screen.getByRole("button", { name: "Guardar cliente" });

    fireEvent.change(email, { target: { value: "noesunemail" } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Email inválido")).toBeInTheDocument();
    });
    expect(updateCustomerContactSpy).not.toHaveBeenCalled();
  });

  // Regression (review-found, additive to the holdout): if the save action
  // REJECTS (transport/server failure, not a returned {error}), the UI must
  // not freeze. Given a dirty draft, when updateCustomerContact throws, then
  // savingCustomer resets, an error is shown, and the button is usable again.
  it("recovers if the save action throws — no permanent 'Guardando...' freeze", async () => {
    updateCustomerContactSpy.mockRejectedValueOnce(new Error("network down"));
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        customer_id: customers[0].id,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "nuevo@mail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cliente" }));

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo guardar el cliente. Intenta de nuevo."),
      ).toBeInTheDocument();
    });
    // Not frozen: dirty draft + not saving → button enabled again, label reset.
    const button = screen.getByRole("button", { name: "Guardar cliente" });
    expect(button).toBeEnabled();
  });

  it("renders Categoría as a Select (not a free-text input)", () => {
    renderForm();
    const trigger = screen.getByLabelText("Categoría");
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
  });

  it("preselects Kilometraje for the canonical enum values (1000/2000/3000)", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        monthly_mileage: 2000,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const trigger = screen.getByLabelText("Kilometraje");
    expect(trigger.textContent).toContain("2.000 km");
  });

  it("preserves a legacy Kilometraje value as a disabled option", () => {
    renderForm({
      id: "55555555-5555-5555-5555-555555555555",
      defaultValues: {
        monthly_mileage: 2,
        status: "reservado",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });
    const trigger = screen.getByLabelText("Kilometraje");
    expect(trigger.textContent).toContain("2 km (legacy)");
  });

  it("shows Sin especificar when monthly_mileage is null", () => {
    renderForm();
    const trigger = screen.getByLabelText("Kilometraje");
    expect(trigger.textContent).toContain("Sin especificar");
  });

  it("filters category options by the selected rental company and keeps a legacy value", () => {
    const mixed = [
      ...vehicleCategories,
      {
        id: "77777777-7777-7777-7777-777777777777",
        code: "HERTZ-ONLY",
        name: "Other Co Category",
        rental_company_id: "99999999-9999-9999-9999-999999999999",
        status: "active",
      },
    ];
    render(
      <ReservationForm
        id="88888888-8888-8888-8888-888888888888"
        defaultValues={{
          rental_company_id: "22222222-2222-2222-2222-222222222222",
          category_code: "LEGACY-INACTIVE",
          status: "reservado",
        } as Parameters<typeof ReservationForm>[0]["defaultValues"]}
        customers={customers}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
        vehicleCategories={mixed}
      />,
    );
    const trigger = screen.getByLabelText("Categoría");
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain("LEGACY-INACTIVE");
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
