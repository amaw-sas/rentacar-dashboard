import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ReservationForm } from "@/components/forms/reservation-form";

// Issue #140: editing a reservation whose customer has a non-CC identification
// type (CE/NIT/PP/TI) showed the "Tipo identificación" select empty
// (placeholder) instead of the stored value. Root cause: the inline customer
// draft starts as EMPTY_CONTACT ("CC") and the real value is applied by a
// post-mount effect, but Radix Select renders <SelectValue> from the value at
// mount only. CC worked solely because it is the default — every other type
// fell back to the placeholder.

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
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/reservations", () => ({
  createReservation: vi.fn(),
  updateReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
}));
vi.mock("@/lib/actions/customers", () => ({ updateCustomerContact: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rentalCompanies = [{ id: "22222222-2222-2222-2222-222222222222", name: "Localiza" }];
const locations = [{ id: "33333333-3333-3333-3333-333333333333", name: "Manizales" }];
const referrals = [{ id: "44444444-4444-4444-4444-444444444444", name: "Daniela", code: "REF1" }];
const vehicleCategories = [
  {
    id: "55555555-5555-5555-5555-555555555555",
    code: "ECON",
    name: "Económico",
    rental_company_id: "22222222-2222-2222-2222-222222222222",
    status: "active",
  },
];

const ID_LABELS: Record<string, string> = {
  CC: "Cédula Ciudadanía",
  CE: "Cédula Extranjería",
  NIT: "NIT",
  PP: "Pasaporte",
  TI: "Tarjeta Identidad",
};

function makeCustomer(idType: string) {
  return {
    id: "pppppppp-pppp-pppp-pppp-pppppppppppp",
    first_name: "Marco",
    last_name: "Lamas",
    identification_type: idType,
    identification_number: "X1234567",
    phone: "+57 300 0000000",
    email: "marco@example.com",
  };
}

describe("ReservationForm — issue #140: identification type pre-selection on edit", () => {
  afterEach(() => cleanup());

  // SCEN-001: every stored type seeds the select trigger on edit load —
  // in-window customer (resolved from `customers`).
  for (const code of ["CC", "CE", "NIT", "PP", "TI"]) {
    it(`seeds the "${code}" type when the linked customer is in the loaded window`, () => {
      const c = makeCustomer(code);
      render(
        <ReservationForm
          id="55555555-5555-5555-5555-555555555555"
          defaultValues={{ customer_id: c.id, status: "reservado" } as Parameters<typeof ReservationForm>[0]["defaultValues"]}
          customers={[c]}
          rentalCompanies={rentalCompanies}
          locations={locations}
          referrals={referrals}
          vehicleCategories={vehicleCategories}
        />,
      );
      const trigger = screen.getByLabelText("Tipo identificación");
      expect(trigger.textContent).toContain(code);
      expect(trigger.textContent).toContain(ID_LABELS[code]);
    });
  }

  // SCEN-002: same, but the customer is outside the getCustomers() 1000-row
  // window (issue #75) — resolved from `selectedCustomer`.
  for (const code of ["CE", "NIT", "PP", "TI"]) {
    it(`seeds the "${code}" type from selectedCustomer when the customer is out of window`, () => {
      const c = makeCustomer(code);
      render(
        <ReservationForm
          id="55555555-5555-5555-5555-555555555555"
          defaultValues={{ customer_id: c.id, status: "reservado" } as Parameters<typeof ReservationForm>[0]["defaultValues"]}
          customers={[]}
          selectedCustomer={c}
          rentalCompanies={rentalCompanies}
          locations={locations}
          referrals={referrals}
          vehicleCategories={vehicleCategories}
        />,
      );
      const trigger = screen.getByLabelText("Tipo identificación");
      expect(trigger.textContent).toContain(code);
      expect(trigger.textContent).toContain(ID_LABELS[code]);
    });
  }

  // SCEN-003: switching customer re-seeds the trigger to the new customer's
  // type — the value transition (post-mount) must still reflect in the trigger.
  it("re-seeds the trigger when the operator switches to a customer with a different type", async () => {
    const cc = {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      first_name: "Daniela",
      last_name: "Carreño",
      identification_type: "CC",
      identification_number: "1007489090",
      phone: "+57 312 0000000",
      email: "daniela@example.com",
    };
    const pp = makeCustomer("PP");
    render(
      <ReservationForm
        id="55555555-5555-5555-5555-555555555555"
        defaultValues={{ customer_id: cc.id, status: "reservado" } as Parameters<typeof ReservationForm>[0]["defaultValues"]}
        customers={[cc, pp]}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
        vehicleCategories={vehicleCategories}
      />,
    );
    // Starts on CC.
    expect(screen.getByLabelText("Tipo identificación").textContent).toContain("CC");
    // Switch to the PP customer via the combobox.
    fireEvent.click(screen.getByLabelText("Cliente"));
    fireEvent.click(await screen.findByText("Marco Lamas"));
    await waitFor(() => {
      expect(screen.getByLabelText("Tipo identificación").textContent).toContain("PP");
    });
    expect(screen.getByLabelText("Tipo identificación").textContent).toContain("Pasaporte");
  });
});
