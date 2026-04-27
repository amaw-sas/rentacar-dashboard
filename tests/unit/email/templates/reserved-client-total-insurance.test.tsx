import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-confirmation";

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
  extraDriver: false,
  babySeat: false,
  wash: false,
  extraDriverDayPrice: 12000,
  washPrice: 20000,
  washOnsitePrice: 30000,
  washDeepPrice: 150000,
  washDeepUpholsteryPrice: 225000,
} as const;

describe("ReservedClientEmail totalInsurance (boolean flag)", () => {
  it("renders 'Seguro Total' in extras when totalInsurance is true, without any currency", async () => {
    const html = await render(
      ReservedClientEmail({ ...baseProps, totalInsurance: true })
    );
    expect(html).toMatch(/Seguro Total/);
    // Must NOT render a currency amount for the insurance line
    expect(html).not.toMatch(/Seguro Total:\s*\$/);
    // Must NOT leak the boolean-as-number "$1" / "$ 1" bug (non-thousands-separated 1)
    expect(html).not.toMatch(/\$\s?1(?!\d|\.|[0-9])/);
    // Must NOT call formatCOP on the insurance flag — es-CO would emit "$ 1"
    expect(html).not.toMatch(/Seguro Total[^<]*\$\s?1(?!\d)/);
  });

  it("omits 'Seguro Total' from extras when totalInsurance is false", async () => {
    const html = await render(
      ReservedClientEmail({ ...baseProps, totalInsurance: false })
    );
    expect(html).not.toMatch(/Seguro Total/);
  });
});
