import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { flexRender } from "@tanstack/react-table";
import { columns, type ReservationRow } from "@/app/(dashboard)/reservations/columns";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const baseRow: ReservationRow = {
  id: "res-1",
  franchise: "alquilame",
  booking_type: "standard",
  category_code: "C",
  pickup_date: "2026-04-20",
  pickup_hour: "12:00:00",
  created_at: "2026-04-16T14:43:00.000Z",
  status: "reservado",
  reservation_code: "AV6OXGXGP",
  total_price: 150000,
  tax_fee: 14278,
  total_price_localiza: 0,
  referral_id: null,
  referral_raw: null,
  customers: {
    first_name: "Daniela",
    last_name: "Carreño",
    identification_number: "1007489090",
    phone: "+57 312 4366514",
    email: "dc005241@gmail.com",
  },
  rental_companies: { name: "Localiza" },
  pickup_location: { name: "Aeropuerto" },
  return_location: { name: "Aeropuerto" },
  referrals: { id: "ref-1", name: "Daniela", code: "DAN" },
};

function headerOf(id: string) {
  const col = columns.find((c) => (c.id ?? (c as { accessorKey?: string }).accessorKey) === id);
  if (!col) throw new Error(`column ${id} not found`);
  return col.header as string;
}

describe("reservations columns (legacy parity)", () => {
  it("exposes columns in legacy order", () => {
    const order = columns
      .map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey)
      .filter((id) => id !== "priority");
    expect(order).toEqual([
      "created_at",
      "customer",
      "identification",
      "phone",
      "email",
      "pickup",
      "reservation_code",
      "category_code",
      "franchise",
      "referral",
      "status",
      "total_with_tax",
      "valor_oc",
      "actions",
    ]);
  });

  it("uses Spanish legacy labels", () => {
    expect(headerOf("created_at")).toBe("Creado");
    expect(headerOf("customer")).toBe("Nombre");
    expect(headerOf("identification")).toBe("ID");
    expect(headerOf("phone")).toBe("Teléfono");
    expect(headerOf("email")).toBe("Email");
    expect(headerOf("pickup")).toBe("Recogida");
    expect(headerOf("reservation_code")).toBe("Código");
    expect(headerOf("category_code")).toBe("Cat.");
    expect(headerOf("franchise")).toBe("Franquicia");
    expect(headerOf("referral")).toBe("Referido");
    expect(headerOf("status")).toBe("Estado");
    expect(headerOf("total_with_tax")).toBe("Total + Tax");
    expect(headerOf("valor_oc")).toBe("Valor OC");
    expect(headerOf("actions")).toBe("Operaciones");
  });

  function accessorOf<T>(id: string): (r: ReservationRow, i?: number) => T {
    const col = columns.find((c) => c.id === id) as unknown as {
      accessorFn: (r: ReservationRow, i: number) => T;
    };
    return (r, i = 0) => col.accessorFn(r, i);
  }

  it("computes Total + Tax as total_price + tax_fee", () => {
    const fn = accessorOf<number>("total_with_tax");
    expect(fn(baseRow)).toBe(164278);
  });

  it("customer accessor joins first + last name", () => {
    const fn = accessorOf<string>("customer");
    expect(fn(baseRow)).toBe("Daniela Carreño");
    expect(fn({ ...baseRow, customers: null })).toBe("");
  });

  it("identification accessor reads from nested customer", () => {
    const fn = accessorOf<string>("identification");
    expect(fn(baseRow)).toBe("1007489090");
    expect(fn({ ...baseRow, customers: null })).toBe("");
  });

  describe("copy-on-click cells", () => {
    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
    });

    afterEach(() => {
      cleanup();
    });

    it("phone cell copies exact phone value to clipboard on click", async () => {
      const col = columns.find((c) => c.id === "phone");
      const rendered = flexRender(col!.cell, {
        getValue: () => "+57 312 4366514",
      } as never);
      const { container } = render(<>{rendered}</>);
      const btn = container.querySelector("button");
      fireEvent.click(btn!);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "+57 312 4366514",
        );
      });
    });

    it("email cell copies exact email value to clipboard on click", async () => {
      const col = columns.find((c) => c.id === "email");
      const rendered = flexRender(col!.cell, {
        getValue: () => "dc005241@gmail.com",
      } as never);
      const { container } = render(<>{rendered}</>);
      const btn = container.querySelector("button");
      fireEvent.click(btn!);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "dc005241@gmail.com",
        );
      });
    });

    it("identification cell copies exact id value to clipboard on click", async () => {
      const col = columns.find((c) => c.id === "identification");
      const rendered = flexRender(col!.cell, {
        getValue: () => "1007489090",
      } as never);
      const { container } = render(<>{rendered}</>);
      const btn = container.querySelector("button");
      fireEvent.click(btn!);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "1007489090",
        );
      });
    });

    it("reservation_code cell copies exact code value to clipboard on click", async () => {
      const col = columns.find(
        (c) => (c as { accessorKey?: string }).accessorKey === "reservation_code",
      );
      const rendered = flexRender(col!.cell, {
        getValue: () => "AV6OXGXGP",
      } as never);
      const { container } = render(<>{rendered}</>);
      const btn = container.querySelector("button");
      fireEvent.click(btn!);
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "AV6OXGXGP",
        );
      });
    });
  });

  describe("libro button", () => {
    afterEach(() => {
      cleanup();
    });

    function renderActions(row: ReservationRow) {
      const col = columns.find((c) => c.id === "actions");
      const rendered = flexRender(col!.cell, {
        row: { original: row },
      } as never);
      return render(<>{rendered}</>);
    }

    it("renders libro link when reservation_code is present", () => {
      const { container } = renderActions(baseRow);
      const libro = container.querySelector(
        `a[href="/reservations/${baseRow.id}/libro"]`,
      );
      expect(libro).not.toBeNull();
      expect(libro?.getAttribute("target")).toBe("_blank");
    });

    it("hides libro link when reservation_code is null", () => {
      const { container } = renderActions({ ...baseRow, reservation_code: null });
      const libro = container.querySelector(
        `a[href="/reservations/${baseRow.id}/libro"]`,
      );
      expect(libro).toBeNull();
    });

    it("hides libro link when reservation_code is empty string", () => {
      const { container } = renderActions({ ...baseRow, reservation_code: "" });
      const libro = container.querySelector(
        `a[href="/reservations/${baseRow.id}/libro"]`,
      );
      expect(libro).toBeNull();
    });
  });

  describe("name truncation", () => {
    afterEach(() => {
      cleanup();
    });

    it("renders short name unchanged in the customer cell", () => {
      const col = columns.find((c) => c.id === "customer");
      const rendered = flexRender(col!.cell, {
        row: { original: baseRow },
      } as never);
      const { container } = render(<>{rendered}</>);
      expect(container.textContent).toContain("Daniela Carreño");
      expect(container.textContent).not.toContain("…");
    });

    it("truncates very long names with an ellipsis", () => {
      const col = columns.find((c) => c.id === "customer");
      const longRow: ReservationRow = {
        ...baseRow,
        customers: {
          ...baseRow.customers!,
          first_name: "Maximiliano Alejandro",
          last_name: "Fernández de la Torre",
        },
      };
      const rendered = flexRender(col!.cell, {
        row: { original: longRow },
      } as never);
      const { container } = render(<>{rendered}</>);
      expect(container.textContent).toContain("…");
      expect(container.textContent).not.toContain("Fernández de la Torre");
    });
  });

  it("referral accessor prefers relation.name, falls back to referral_raw", () => {
    const fn = accessorOf<string>("referral");
    expect(fn(baseRow)).toBe("Daniela");
    expect(
      fn({ ...baseRow, referrals: null, referral_raw: "Pedro" }),
    ).toBe("Pedro");
    expect(
      fn({ ...baseRow, referrals: null, referral_raw: null }),
    ).toBe("");
  });

  describe("valor_oc column", () => {
    afterEach(() => {
      cleanup();
    });

    const formatter = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    });

    function renderValorOcCell(value: unknown) {
      const col = columns.find((c) => c.id === "valor_oc");
      const rendered = flexRender(col!.cell, {
        getValue: () => value,
      } as never);
      return render(<>{rendered}</>);
    }

    it("renders total_price_localiza formatted as currency for non-zero value", () => {
      const { container } = renderValorOcCell(152300);
      expect(container.textContent).toBe(formatter.format(152300));
    });

    it("renders zero as formatted currency, not as a placeholder dash", () => {
      const { container } = renderValorOcCell(0);
      expect(container.textContent).toBe(formatter.format(0));
      expect(container.textContent).not.toBe("—");
    });

    it("coerces string-typed value (PostgREST numeric serialization) to number before formatting", () => {
      const { container } = renderValorOcCell("152300");
      expect(container.textContent).toBe(formatter.format(152300));
    });

    it("does not opt out of sorting", () => {
      const col = columns.find((c) => c.id === "valor_oc");
      expect(col).not.toHaveProperty("enableSorting", false);
    });
  });
});
