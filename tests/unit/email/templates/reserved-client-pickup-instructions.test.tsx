import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-client";

const baseProps = {
  franchiseName: "Alquilatucarro",
  franchiseColor: "#0055a5",
  franchiseWebsite: "https://alquilatucarro.co",
  franchisePhone: "3002436677",
  customerName: "Juan Perez",
  categoryName: "Gama C Económico",
  pickupLocation: "Bogotá Aeropuerto",
  pickupDate: "15 de mayo 2026",
  pickupHour: "9:00 AM",
  returnLocation: "Bogotá Aeropuerto",
  returnDate: "20 de mayo 2026",
  returnHour: "9:00 AM",
  selectedDays: 5,
  reserveCode: "ABC123",
  totalPrice: 1_000_000,
  taxFee: 100_000,
  ivaFee: 190_000,
  totalPriceToPay: 1_290_000,
  totalInsurance: 0,
  extraDriver: false,
  babySeat: false,
  wash: false,
  extraDriverDayPrice: 12000,
  washPrice: 20000,
  washOnsitePrice: 30000,
  washDeepPrice: 150000,
  washDeepUpholsteryPrice: 225000,
};

describe("ReservedClientEmail pickup instructions", () => {
  it("renders 'ANTES DE RECOGER EL VEHÍCULO' section with 30-min early arrival + document list", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/ANTES DE RECOGER EL VEH(Í|&#205;|&Iacute;)CULO/i);
    expect(html).toMatch(/30 minutos antes/i);
    expect(html).toMatch(/Tarjeta de Cr(é|&#233;|&eacute;)dito/i);
    expect(html).toMatch(/C(é|&#233;|&eacute;)dula/i);
    expect(html).toMatch(/Pasaporte/i);
    expect(html).toMatch(/Licencia de Conducci(ó|&#243;|&oacute;)n/i);
  });

  it("renders 'CONDUCTOR ADICIONAL' section using extra_driver_day_price from props", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/Conductor adicional/i);
    // COP formatting for 12000 on es-CO
    expect(html).toMatch(/\$\s?12\.000/);
  });

  it("renders 'DURANTE LA RECOGIDA DEL VEHÍCULO' section", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/DURANTE LA RECOGIDA DEL VEH(Í|&#205;|&Iacute;)CULO/i);
    expect(html).toMatch(/tanque lleno/i);
    expect(html).toMatch(/registro fotogr(á|&#225;|&aacute;)fico/i);
  });

  it("renders 'DURANTE EL PERIODO DE RENTA' with AUTOSEGURO emergency line verbatim", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/DURANTE EL PERIODO DE RENTA/i);
    expect(html).toContain("AUTOSEGURO");
    expect(html).toContain("4-4442001");
    expect(html).toMatch(/#570/);
    expect(html).toMatch(/pico y placa/i);
    expect(html).toMatch(/no puede salir del pa(í|&#237;|&iacute;)s/i);
  });

  it("renders 'ANTES DE RETORNAR EL VEHÍCULO' section", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/ANTES DE RETORNAR EL VEH(Í|&#205;|&Iacute;)CULO/i);
    expect(html).toMatch(/tanque est(é|&#233;|&eacute;) lleno/i);
    expect(html).toMatch(/art(í|&#237;|&iacute;)culos personales/i);
  });

  it("renders 'LAVADO DE VEHÍCULO' with all 4 prices from props (no hardcoded literals)", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    expect(html).toMatch(/LAVADO DE VEH(Í|&#205;|&Iacute;)CULO/i);
    // COP formatting on es-CO renders "$ 20.000" / "$ 30.000" / "$ 150.000" / "$ 225.000"
    expect(html).toMatch(/\$\s?20\.000/);
    expect(html).toMatch(/\$\s?30\.000/);
    expect(html).toMatch(/\$\s?150\.000/);
    expect(html).toMatch(/\$\s?225\.000/);
  });

  it("prices are data-driven: different props produce different rendered amounts", async () => {
    const html = await render(
      ReservedClientEmail({
        ...baseProps,
        extraDriverDayPrice: 15000,
        washOnsitePrice: 45000,
        washDeepPrice: 200000,
        washDeepUpholsteryPrice: 300000,
      })
    );
    expect(html).toMatch(/\$\s?15\.000/);
    expect(html).toMatch(/\$\s?45\.000/);
    expect(html).toMatch(/\$\s?200\.000/);
    expect(html).toMatch(/\$\s?300\.000/);
    // Old defaults must NOT leak through
    expect(html).not.toMatch(/\$\s?12\.000/);
  });
});
