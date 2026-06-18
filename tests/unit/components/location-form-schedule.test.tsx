import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type LocationSchedule } from "@/lib/schemas/location";

// Issue #97 — schedule round-trip through the form. Validates the latent-bug fix
// (editing a location no longer wipes schedule) and the create path.

vi.mock("@/lib/actions/locations", () => ({
  createLocation: vi.fn().mockResolvedValue({}),
  updateLocation: vi.fn().mockResolvedValue({}),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const RC_ID = "11111111-1111-4111-8111-111111111111";
const CITY_ID = "22222222-2222-4222-8222-222222222222";

const rentalCompanies = [{ id: RC_ID, name: "Rentadora" }];
const cities = [{ id: CITY_ID, name: "Bogotá" }];

const validDefaults = {
  rental_company_id: RC_ID,
  code: "ATEST",
  name: "Sucursal Test",
  pickup_address: "Calle 1 #2-3",
  pickup_map: "https://maps.example/x",
  city_id: CITY_ID,
  status: "active" as const,
};

function scheduleOf(fd: FormData): LocationSchedule {
  return JSON.parse(fd.get("schedule") as string);
}

describe("LocationForm — schedule round-trip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SCEN-009: editing only the name preserves the schedule (not {})", async () => {
    const { updateLocation } = await import("@/lib/actions/locations");
    const { LocationForm } = await import("@/components/forms/location-form");

    const schedule: LocationSchedule = {
      mon: ["08:00-18:00"],
      sat: ["08:00-13:00"],
    };
    render(
      <LocationForm
        id="loc-1"
        defaultValues={{ ...validDefaults, schedule }}
        rentalCompanies={rentalCompanies}
        cities={cities}
      />,
    );

    // Change ONLY the name; never touch the schedule editor.
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Renombrada" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => expect(updateLocation).toHaveBeenCalled());
    const [, fd] = vi.mocked(updateLocation).mock.calls[0];
    const sent = scheduleOf(fd);
    expect(sent).toEqual({ mon: ["08:00-18:00"], sat: ["08:00-13:00"] });
    expect(sent).not.toEqual({});
  });

  it("SCEN-010: creating a location serializes the edited schedule", async () => {
    const { createLocation } = await import("@/lib/actions/locations");
    const { LocationForm } = await import("@/components/forms/location-form");

    render(
      <LocationForm
        defaultValues={validDefaults}
        rentalCompanies={rentalCompanies}
        cities={cities}
      />,
    );

    // Set Monday to a range via the editor.
    fireEvent.change(screen.getByLabelText("Modo Lunes"), {
      target: { value: "range" },
    });
    fireEvent.click(screen.getByRole("button", { name: /crear sucursal/i }));

    await waitFor(() => expect(createLocation).toHaveBeenCalled());
    const [fd] = vi.mocked(createLocation).mock.calls[0];
    const sent = scheduleOf(fd);
    expect(sent.mon).toEqual(["08:00-18:00"]);
  });

  it("SCEN-004a (form): an inverted range blocks submit (action not called)", async () => {
    const { updateLocation } = await import("@/lib/actions/locations");
    const { LocationForm } = await import("@/components/forms/location-form");

    render(
      <LocationForm
        id="loc-1"
        defaultValues={{ ...validDefaults, schedule: { mon: ["08:00-18:00"] } }}
        rentalCompanies={rentalCompanies}
        cities={cities}
      />,
    );

    // Invert the Monday range: start 19:00 > end 18:00.
    fireEvent.change(screen.getByLabelText("Inicio Lunes"), {
      target: { value: "19:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /guardar cambios/i }));

    // zodResolver rejects the inverted range → handleSubmit never runs onSubmit.
    await new Promise((r) => setTimeout(r, 0));
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it("shows a live display preview derived from the structured schedule", async () => {
    const { LocationForm } = await import("@/components/forms/location-form");

    render(
      <LocationForm
        id="loc-1"
        defaultValues={{
          ...validDefaults,
          schedule: { mon: ["08:00-18:00"], tue: ["08:00-18:00"] },
        }}
        rentalCompanies={rentalCompanies}
        cities={cities}
      />,
    );

    expect(screen.getByText(/Lun-Mar 08:00-18:00/)).toBeInTheDocument();
  });
});
