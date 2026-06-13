import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CustomerForm } from "@/components/forms/customer-form";

// Guard against the #140 class of bug in the standalone customer edit form.
// reservation-form.tsx showed the identification-type Select empty for every
// non-CC type because it seeded the value via a post-mount effect, which Radix
// Select does not reflect in its trigger. customer-form seeds via useForm
// defaultValues instead — the value is correct at first render, so it is NOT
// affected. This test pins that behavior so a future refactor to effect-based
// seeding can't silently reintroduce the bug here.

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
vi.mock("@/lib/actions/customers", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

const ID_LABELS: Record<string, string> = {
  CC: "Cédula de Ciudadanía",
  CE: "Cédula de Extranjería",
  NIT: "NIT",
  PP: "Pasaporte",
  TI: "Tarjeta de Identidad",
};

describe("CustomerForm — identification type pre-selection on edit (#140 guard)", () => {
  afterEach(() => cleanup());

  for (const code of ["CC", "CE", "NIT", "PP", "TI"]) {
    it(`pre-selects the "${code}" type in edit mode`, () => {
      render(
        <CustomerForm
          id="abcabcab-abca-abca-abca-abcabcabcabc"
          defaultValues={{
            first_name: "Marco",
            last_name: "Lamas",
            identification_type: code as "CC" | "CE" | "NIT" | "PP" | "TI",
            identification_number: "X1234567",
            phone: "+57 300 0000000",
            email: "marco@example.com",
            notes: "",
            status: "active",
          }}
        />,
      );
      const trigger = screen.getByLabelText("Tipo de identificación");
      expect(trigger.textContent).toContain(code);
      expect(trigger.textContent).toContain(ID_LABELS[code]);
    });
  }
});
