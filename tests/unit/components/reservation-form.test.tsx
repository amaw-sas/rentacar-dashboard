import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ReservationForm } from "@/components/forms/reservation-form";
import {
  updateReservation,
  updateReservationStatus,
} from "@/lib/actions/reservations";

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

  describe("referral attribution is read-only on edit (issue #48)", () => {
    it("disables the referral_id Select trigger when editing", () => {
      renderForm({
        id: "88888888-8888-8888-8888-888888888888",
        defaultValues: {
          referral_id: "44444444-4444-4444-4444-444444444444",
          status: "reservado",
        } as Parameters<typeof ReservationForm>[0]["defaultValues"],
      });
      const trigger = screen.getByLabelText("Referido");
      expect(trigger).toBeDisabled();
      // Value remains visible to the operator.
      expect(trigger.textContent).toContain("Daniela");
    });

    it("disables the referral_raw input when editing", () => {
      renderForm({
        id: "88888888-8888-8888-8888-888888888888",
        defaultValues: {
          referral_raw: "feria-2026",
          status: "reservado",
        } as Parameters<typeof ReservationForm>[0]["defaultValues"],
      });
      const input = screen.getByLabelText("Referido (texto libre)");
      expect(input).toBeDisabled();
      expect(input).toHaveValue("feria-2026");
    });

    it("keeps referral controls editable when creating a new reservation", () => {
      renderForm();
      const trigger = screen.getByLabelText("Referido");
      const input = screen.getByLabelText("Referido (texto libre)");
      expect(trigger).not.toBeDisabled();
      expect(input).not.toBeDisabled();
    });
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

// Issue #75: after the legacy customers ETL (#19), `customers` has ~11k rows
// but getCustomers() returns only the first 1000 (PostgREST cap). The form
// seeded contact inputs + combobox label via customers.find(customerId),
// which returned undefined for ~84% of reservations → empty section. The fix
// passes the reservation's linked customer as `selectedCustomer`; the form
// seeds from it (and merges it into the combobox options) when the active
// customer is outside the loaded window.
describe("ReservationForm — issue #75: linked customer outside the getCustomers() window", () => {
  afterEach(() => cleanup());

  // Deliberately NOT present in the `customers` array above — simulates a
  // customer whose last_name sorts beyond the 1000-row window.
  const customerOutOfWindow = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    first_name: "Juan",
    last_name: "Pérez",
    identification_type: "CC",
    identification_number: "1020304050",
    phone: "+57 300 1112233",
    email: "juan@example.com",
  };

  function renderEdit(
    selectedCustomer: typeof customerOutOfWindow | undefined,
    customerId: string,
  ) {
    return render(
      <ReservationForm
        id="55555555-5555-5555-5555-555555555555"
        defaultValues={
          {
            customer_id: customerId,
            status: "reservado",
          } as Parameters<typeof ReservationForm>[0]["defaultValues"]
        }
        customers={customers}
        selectedCustomer={selectedCustomer}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
        vehicleCategories={vehicleCategories}
      />,
    );
  }

  // SCEN-001: cliente fuera de la ventana → inputs + combobox poblados.
  it("seeds inputs and combobox label from selectedCustomer when the customer is not in the loaded list", () => {
    renderEdit(customerOutOfWindow, customerOutOfWindow.id);
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Juan",
    );
    expect((screen.getByLabelText("Apellido") as HTMLInputElement).value).toBe(
      "Pérez",
    );
    expect(
      (screen.getByLabelText("Identificación") as HTMLInputElement).value,
    ).toBe("1020304050");
    expect((screen.getByLabelText("Teléfono") as HTMLInputElement).value).toBe(
      "+57 300 1112233",
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "juan@example.com",
    );
    expect(screen.getByLabelText("Tipo identificación").textContent).toContain(
      "CC",
    );
    expect(screen.getByLabelText("Cliente").textContent).toContain(
      "Juan Pérez",
    );
  });

  // SCEN-002: cliente dentro de la ventana → sin regresión.
  it("still seeds from the loaded list when the customer is in the window (no regression)", () => {
    renderEdit(undefined, customers[0].id);
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Daniela",
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "dc005241@gmail.com",
    );
    expect(screen.getByLabelText("Cliente").textContent).toContain(
      "Daniela Carreño",
    );
  });

  // SCEN-003: el fallback está acotado por id — no clobberea otro cliente.
  it("scopes the selectedCustomer fallback by id — a different active customer is not clobbered", () => {
    // selectedCustomer = Juan (out-of-window), but active customer_id = Daniela
    // (in window). find() resolves Daniela; the fallback must NOT apply.
    renderEdit(customerOutOfWindow, customers[0].id);
    const nombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    expect(nombre.value).toBe("Daniela");
    expect(nombre.value).not.toBe("Juan");
  });

  // SCEN-006 (de #36) preservado: cambiar de cliente vía combobox re-siembra
  // desde la lista in-window, NO desde el linked record fuera de ventana.
  // El code-reviewer pidió ejercitar el switch real, no sólo afirmarlo en
  // comentarios.
  it("re-seeds from the in-window list when the operator switches customer", async () => {
    renderEdit(customerOutOfWindow, customerOutOfWindow.id);
    // Sembrado inicial desde el cliente vinculado (fuera de ventana).
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
      "Juan",
    );
    // Abrir el combobox y seleccionar el cliente in-window (Daniela).
    fireEvent.click(screen.getByLabelText("Cliente"));
    const option = await screen.findByText("Daniela Carreño");
    fireEvent.click(option);
    // customerId cambió → el efecto refire → siembra desde `customers`, no
    // desde el linked record obsoleto.
    await waitFor(() => {
      expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe(
        "Daniela",
      );
    });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "dc005241@gmail.com",
    );
  });

  // SCEN-004: nueva reserva sin selectedCustomer → sección Cliente vacía.
  it("starts empty on a new reservation (no selectedCustomer, no customer_id)", () => {
    render(
      <ReservationForm
        customers={customers}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
        vehicleCategories={vehicleCategories}
      />,
    );
    const nombre = screen.getByLabelText("Nombre") as HTMLInputElement;
    expect(nombre.value).toBe("");
    expect(nombre).toBeDisabled();
    expect(screen.getByLabelText("Cliente").textContent).toContain(
      "Seleccionar cliente",
    );
  });
});

// Issue #153 (supersedes #90 SCEN-001..003, 005, 007, 008): the status
// transition button reads the reservation live from the DB. Instead of BLOCKING
// on unsaved form/customer edits (#90), the form now AUTOSAVES whatever is dirty
// (form via updateReservation + reset, customer contact via handleSaveCustomer)
// BEFORE dispatching the status — so the notification still fires with fresh
// data. If the save fails, the status change is aborted and the error is shown.
describe("ReservationForm — autosave on status change (issue #153)", () => {
  const statusSpy = vi.mocked(updateReservationStatus);
  const updateReservationSpy = vi.mocked(updateReservation);
  const EDIT_ID = "55555555-5555-5555-5555-555555555555";

  // reservationSchema validates the relation fields with zod `.uuid()`, which in
  // zod 4 enforces the version/variant nibbles — so the repeated-digit ids used
  // elsewhere ("11111111-…") FAIL. The autosave tests must mount a form whose
  // trigger() actually passes, so this block uses RFC-4122-compliant ids
  // (version 4, variant 8) for every zod-validated relation.
  const validCustomers = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      first_name: "Daniela",
      last_name: "Carreño",
      identification_type: "CC",
      identification_number: "1007489090",
      phone: "+57 312 4366514",
      email: "dc005241@gmail.com",
    },
  ];
  const validRentalCompanies = [
    { id: "22222222-2222-4222-8222-222222222222", name: "Localiza" },
  ];
  const validLocations = [
    { id: "33333333-3333-4333-8333-333333333333", name: "Manizales Mall Plaza" },
  ];
  const validVehicleCategories = [
    {
      id: "55555555-5555-4555-8555-555555555555",
      code: "ECON",
      name: "Económico",
      rental_company_id: validRentalCompanies[0].id,
      status: "active",
    },
  ];

  // A fully-valid mounted reservation: every required field (uuids + dates +
  // hours + selected_days) satisfies reservationSchema, so persistReservation's
  // trigger() passes and the form actually saves. Tests that need an INVALID
  // form (SCEN-005) clear a single required field after mount.
  const VALID_EDIT = {
    customer_id: validCustomers[0].id,
    rental_company_id: validRentalCompanies[0].id,
    pickup_location_id: validLocations[0].id,
    return_location_id: validLocations[0].id,
    category_code: validVehicleCategories[0].code,
    pickup_date: "2026-07-01",
    pickup_hour: "10:00",
    return_date: "2026-07-05",
    return_hour: "10:00",
    selected_days: 5,
    status: "nueva",
  } as Parameters<typeof ReservationForm>[0]["defaultValues"];

  const renderValid = (
    overrides?: Partial<NonNullable<Parameters<typeof ReservationForm>[0]["defaultValues"]>>,
  ) =>
    render(
      <ReservationForm
        id={EDIT_ID}
        defaultValues={{
          ...VALID_EDIT,
          ...overrides,
        } as Parameters<typeof ReservationForm>[0]["defaultValues"]}
        customers={validCustomers}
        rentalCompanies={validRentalCompanies}
        locations={validLocations}
        referrals={referrals}
        vehicleCategories={validVehicleCategories}
      />,
    );

  afterEach(() => {
    cleanup();
    statusSpy.mockReset();
    updateReservationSpy.mockReset();
    updateCustomerContactSpy.mockReset();
  });

  // SCEN-001: editing a `register` form field autosaves the reservation
  // (updateReservation) BEFORE dispatching the status (updateReservationStatus).
  it("autosaves the form then changes the status when a register field is edited", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).toHaveBeenCalled();
    // Save ran before the status dispatch.
    expect(
      updateReservationSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(statusSpy.mock.invocationCallOrder[0]);
    // The new value reached the persisted FormData.
    const [, fd] = updateReservationSpy.mock.calls[0];
    expect((fd as FormData).get("selected_days")).toBe("7");
  });

  // SCEN-002: editing the inline customer contact autosaves it
  // (updateCustomerContact) BEFORE the status dispatch.
  it("autosaves the customer contact then changes the status", async () => {
    updateCustomerContactSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderForm({
      id: EDIT_ID,
      defaultValues: {
        customer_id: customers[0].id,
        status: "nueva",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nuevo@mail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateCustomerContactSpy).toHaveBeenCalled();
    expect(
      updateCustomerContactSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(statusSpy.mock.invocationCallOrder[0]);
  });

  // SCEN-003: both form and contact dirty → both persist before the status,
  // which fires exactly once.
  it("autosaves both the form and the contact before the status change", async () => {
    updateReservationSpy.mockResolvedValue({});
    updateCustomerContactSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nuevo@mail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).toHaveBeenCalled();
    expect(updateCustomerContactSpy).toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(
      updateReservationSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(statusSpy.mock.invocationCallOrder[0]);
    expect(
      updateCustomerContactSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(statusSpy.mock.invocationCallOrder[0]);
  });

  // SCEN-004: nothing dirty → no autosave (no-op), status fires directly.
  it("does not autosave when nothing is dirty", async () => {
    updateReservationSpy.mockResolvedValue({});
    updateCustomerContactSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderForm({
      id: EDIT_ID,
      defaultValues: {
        customer_id: customers[0].id,
        status: "nueva",
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).not.toHaveBeenCalled();
    expect(updateCustomerContactSpy).not.toHaveBeenCalled();
  });

  // SCEN-005: an invalid required form field (empty "Día recogida") aborts —
  // the form does not persist, the status is not dispatched, and a validation
  // error shows in the root error slot.
  it("aborts the status change when the form is invalid", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid();

    // Clear a required field → zod .min(1) fails.
    fireEvent.change(screen.getByLabelText("Día recogida"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(screen.getByText(/Revisa los campos con error/i)).toBeInTheDocument(),
    );
    expect(updateReservationSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
  });

  // SCEN-006: a server error from updateReservation aborts — the status is not
  // dispatched and the error is shown in the root slot.
  it("aborts the status change when the save returns a server error", async () => {
    updateReservationSpy.mockResolvedValue({ error: "boom" });
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() => expect(updateReservationSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("boom")).toBeInTheDocument(),
    );
    expect(statusSpy).not.toHaveBeenCalled();
  });

  // SCEN-007 (form half): a dangerous target with a dirty field — cancelling the
  // window.confirm aborts before ANY save or status dispatch.
  it("does not autosave or change status when a dangerous-target confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    updateReservationSpy.mockResolvedValue({});
    updateCustomerContactSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    // "Cancelado" is a dangerous target → triggers window.confirm.
    fireEvent.click(screen.getByRole("button", { name: "Cancelado" }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateReservationSpy).not.toHaveBeenCalled();
    expect(updateCustomerContactSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // SCEN-008: regression guard for RHF false-dirty. A freshly mounted edit form
  // with realistic numeric defaults (numbers vs `register` strings) must NOT be
  // considered dirty → no spurious autosave; the status still fires.
  it("does not autosave on a freshly loaded form with numeric defaults (no false-dirty)", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderForm({
      id: EDIT_ID,
      defaultValues: {
        customer_id: customers[0].id,
        status: "nueva",
        selected_days: 5,
        coverage_days: 3,
        extra_hours: 2,
        total_price: 250000,
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });

    // No interaction — just click the status button.
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).not.toHaveBeenCalled();
  });

  // SCEN-009: editing a numeric register input and reverting it to the EXACT
  // original value clears the dirty flag → no autosave; the status still fires.
  it("does not autosave after a numeric field is edited then reverted", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderForm({
      id: EDIT_ID,
      defaultValues: {
        customer_id: customers[0].id,
        status: "nueva",
        selected_days: 5,
      } as Parameters<typeof ReservationForm>[0]["defaultValues"],
    });

    const dias = screen.getByLabelText("Días reservados");
    fireEvent.change(dias, { target: { value: "7" } }); // dirty
    fireEvent.change(dias, { target: { value: "5" } }); // revert to default

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).not.toHaveBeenCalled();
  });

  // SCEN-010: a field persisted via setValue (NOT register) must count as dirty
  // and be autosaved. Radix Select options don't render in jsdom, so we drive
  // the equivalent setValue path via the "Conductor adicional" checkbox; the
  // Select fields (location, franchise, category…) share the identical
  // `setValue(..., { shouldDirty: true })` wiring.
  it("autosaves a setValue field (checkbox) then changes the status", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid();

    // Toggling this checkbox persists via setValue("extra_driver", …) with
    // shouldDirty.
    fireEvent.click(screen.getByLabelText("Conductor adicional"));
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
    expect(updateReservationSpy).toHaveBeenCalled();
    expect(
      updateReservationSpy.mock.invocationCallOrder[0],
    ).toBeLessThan(statusSpy.mock.invocationCallOrder[0]);
  });

  // SCEN-012: after autosaving, the form is reset (reset(getValues) clears
  // dirtyFields). A second status click without touching any field must NOT
  // re-save the form.
  it("does not re-autosave on a second status change after the form was reset", async () => {
    updateReservationSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    // First status click → autosaves once.
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));
    await waitFor(() =>
      expect(updateReservationSpy).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(1));

    // Second status click without touching any field.
    fireEvent.click(screen.getByRole("button", { name: "Pendiente" }));
    await waitFor(() => expect(statusSpy).toHaveBeenCalledTimes(2));
    // Form was reset → still only one save.
    expect(updateReservationSpy).toHaveBeenCalledTimes(1);
  });

  // SCEN-013: after a failed save, the form stays editable (loading flags
  // cleared) and a retry succeeds. First save returns {error}, second resolves.
  it("keeps the form editable after a failed save and allows retry", async () => {
    updateReservationSpy
      .mockResolvedValueOnce({ error: "boom" })
      .mockResolvedValueOnce({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    const dias = screen.getByLabelText("Días reservados") as HTMLInputElement;
    fireEvent.change(dias, { target: { value: "7" } });

    // First attempt fails: status not dispatched, error shown, field editable.
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));
    await waitFor(() =>
      expect(screen.getByText("boom")).toBeInTheDocument(),
    );
    expect(statusSpy).not.toHaveBeenCalled();
    expect(dias).not.toBeDisabled();

    // Retry: second save succeeds, status dispatches.
    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));
    await waitFor(() =>
      expect(statusSpy).toHaveBeenCalledWith(EDIT_ID, "reservado"),
    );
  });

  // SCEN-015: with the form dirty AND the customer contact invalid, the contact
  // must be pre-validated BEFORE the form is written — otherwise the form
  // half-commits while the contact and status never change. Nothing persists.
  it("aborts before persisting the form when the customer contact is invalid", async () => {
    updateReservationSpy.mockResolvedValue({});
    updateCustomerContactSpy.mockResolvedValue({});
    statusSpy.mockResolvedValue({});
    renderValid({ selected_days: 5 });

    // Form dirty.
    fireEvent.change(screen.getByLabelText("Días reservados"), {
      target: { value: "7" },
    });
    // Customer contact dirty AND invalid.
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "noesunemail" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Reservado" }));

    await waitFor(() =>
      expect(screen.getByText("Email inválido")).toBeInTheDocument(),
    );
    // No half-commit: neither write happened, status not dispatched.
    expect(updateReservationSpy).not.toHaveBeenCalled();
    expect(updateCustomerContactSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
  });
});
