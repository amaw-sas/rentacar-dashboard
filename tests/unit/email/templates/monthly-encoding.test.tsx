import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { MonthlyLocalizaEmail } from "@/lib/email/templates/monthly-localiza";

const baseProps = {
  franchiseName: "Alquilame",
  franchiseColor: "#cc022b",
  franchiseWebsite: "https://alquilame.co",
  franchisePhone: "3002436677",
  customerName: "Juan Perez",
  categoryName: "Gama C Económico",
  pickupLocation: "Bogotá Aeropuerto",
  pickupDate: "15 de mayo 2026",
  pickupHour: "9:00 AM",
  returnLocation: "Bogotá Aeropuerto",
  returnDate: "14 de junio 2026",
  returnHour: "9:00 AM",
  selectedDays: 30,
  monthlyMileage: 1000,
  extraDriver: false,
  babySeat: false,
  wash: false,
  totalInsurance: false,
};

describe("MonthlyLocalizaEmail encoding", () => {
  it("renders Spanish accents as real UTF-8 characters, not escape sequences", async () => {
    const html = await render(MonthlyLocalizaEmail(baseProps));
    // Literal unicode escapes must NOT appear
    expect(html).not.toContain("\\u00f1");
    expect(html).not.toContain("\\u00e9");
    expect(html).not.toContain("\\u2014");
    expect(html).not.toContain("\\u2022");
  });

  it("renders 'Señores Localiza' with tilde", async () => {
    const html = await render(MonthlyLocalizaEmail(baseProps));
    expect(html).toMatch(/Se(ñ|&#241;|&ntilde;)ores Localiza/);
  });

  it("renders 'Categoría' and 'Devolución' with accents", async () => {
    const html = await render(MonthlyLocalizaEmail(baseProps));
    expect(html).toMatch(/Categor(í|&#237;|&iacute;)a/);
    expect(html).toMatch(/Devoluci(ó|&#243;|&oacute;)n/);
  });

  it("renders extras with bullet points when present", async () => {
    const html = await render(
      MonthlyLocalizaEmail({
        ...baseProps,
        babySeat: true,
        wash: true,
      })
    );
    expect(html).toContain("Silla de beb");
    expect(html).toContain("Servicio de lavado");
    // bullet character or its entity
    expect(html).toMatch(/(•|&#8226;|&bull;)/);
  });

  it("includes mileage label for monthly reservation", async () => {
    const html = await render(
      MonthlyLocalizaEmail({ ...baseProps, monthlyMileage: 2000 })
    );
    expect(html).toContain("2.000 km/mes");
  });
});
