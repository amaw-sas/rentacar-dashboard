import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "@/components/ui/combobox";

type Customer = {
  id: string;
  first_name: string;
  last_name: string;
  identification_number: string | null;
  phone: string | null;
};

const customers: Customer[] = [
  { id: "1", first_name: "Juan", last_name: "Pérez", identification_number: "1001", phone: "555-1" },
  { id: "2", first_name: "María", last_name: "Gómez", identification_number: "1002", phone: "555-2" },
  { id: "3", first_name: "Andrés", last_name: "Castro", identification_number: "9999", phone: "555-3" },
];

function setup(overrides?: Partial<React.ComponentProps<typeof Combobox<Customer>>>) {
  const onChange = overrides?.onChange ?? vi.fn();
  const utils = render(
    <Combobox<Customer>
      options={customers}
      value={overrides?.value ?? null}
      onChange={onChange}
      getId={(c) => c.id}
      getLabel={(c) => `${c.first_name} ${c.last_name}`.trim()}
      getSearchKeys={(c) => [c.first_name, c.last_name, c.identification_number ?? ""]}
      placeholder={overrides?.placeholder ?? "Seleccionar cliente"}
      searchPlaceholder={overrides?.searchPlaceholder ?? "Buscar por nombre o identificación…"}
      emptyMessage={overrides?.emptyMessage ?? "Sin clientes que coincidan"}
    />,
  );
  return { ...utils, onChange, user: userEvent.setup() };
}

describe("Combobox", () => {
  it("muestra el placeholder cuando no hay valor", () => {
    setup({ value: null });
    expect(screen.getByRole("combobox")).toHaveTextContent("Seleccionar cliente");
  });

  it("muestra el label de la opción seleccionada", () => {
    setup({ value: "2" });
    expect(screen.getByRole("combobox")).toHaveTextContent("María Gómez");
  });

  it("abre el dropdown al hacer click y muestra todas las opciones", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Juan Pérez")).toBeInTheDocument();
    expect(within(listbox).getByText("María Gómez")).toBeInTheDocument();
    expect(within(listbox).getByText("Andrés Castro")).toBeInTheDocument();
  });

  it("filtra opciones por nombre", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Buscar por nombre o identificación…"), "juan");
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Juan Pérez")).toBeInTheDocument();
    expect(within(listbox).queryByText("María Gómez")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("Andrés Castro")).not.toBeInTheDocument();
  });

  it("filtra opciones por identificación", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Buscar por nombre o identificación…"), "9999");
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("Andrés Castro")).toBeInTheDocument();
    expect(within(listbox).queryByText("Juan Pérez")).not.toBeInTheDocument();
  });

  it("NO filtra por campos fuera de getSearchKeys (teléfono)", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Buscar por nombre o identificación…"), "555-1");
    expect(await screen.findByText("Sin clientes que coincidan")).toBeInTheDocument();
  });

  it("muestra emptyMessage cuando no hay coincidencias", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByPlaceholderText("Buscar por nombre o identificación…"), "zzzzz");
    expect(await screen.findByText("Sin clientes que coincidan")).toBeInTheDocument();
  });

  it("llama onChange con el id correcto al seleccionar y cierra el popover", async () => {
    const onChange = vi.fn();
    const { user } = setup({ onChange });
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("María Gómez"));
    expect(onChange).toHaveBeenCalledWith("2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
