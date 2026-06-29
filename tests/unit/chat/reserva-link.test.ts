import { describe, it, expect } from "vitest";
import { encodeQuote } from "@/lib/api/mcp/quote";
import {
  buildFallbackLinks,
  buildOnDemandLinks,
  buildSelfServeLinks,
} from "@/lib/chat/reserva-link";
import type { LocationDirectoryItem } from "@/lib/api/location-directory";

// The fallback links must match the website's deep-link contract EXACTLY (the
// router resolves lugar-recogida by sede slug) so a failed chat booking can be
// finished on the web or via the advisor's WhatsApp with everything pre-filled.

const directory: LocationDirectoryItem[] = [
  {
    slug: "armenia-aeropuerto",
    code: "AAEOQ",
    city: "armenia",
    name: "Armenia Aeropuerto",
    status: "active",
    pickup_address: "Aeropuerto el Edén",
    pickup_map: "https://maps.example/armenia",
    schedule: { display: "L-D 7am-7pm" },
  },
];

const quote = encodeQuote({
  pickupLocation: "AAEOQ",
  returnLocation: "AAEOQ",
  pickupDateTime: "2026-08-01T12:00:00",
  returnDateTime: "2026-08-08T12:00:00",
  selected_days: 7,
  categoryCode: "FX",
  referenceToken: "ref-tok",
  rateQualifier: "rate-q",
  total_price: 1000000,
  total_price_to_pay: 1261569,
  tax_fee: 0,
  iva_fee: 0,
  coverage_days: 7,
  coverage_price: 0,
  return_fee: 0,
  extra_hours: 0,
  extra_hours_price: 0,
});

const customer = {
  fullname: "Diego Melo",
  identification_type: "CC",
  identification: "1020304050",
  email: "diego@example.com",
  phone: "573001112233",
};

describe("buildFallbackLinks", () => {
  it("builds the website deep-link matching the slug contract", () => {
    const links = buildFallbackLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    expect(links?.webUrl).toBe(
      "https://alquilatucarro.com/armenia/buscar-vehiculos" +
        "/lugar-recogida/armenia-aeropuerto/lugar-devolucion/armenia-aeropuerto" +
        "/fecha-recogida/2026-08-01/fecha-devolucion/2026-08-08" +
        "/hora-recogida/12:00/hora-devolucion/12:00/categoria/fx",
    );
  });

  it("builds a wa.me link with the brand number and all reservation data", () => {
    const links = buildFallbackLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    expect(links?.whatsappUrl.startsWith("https://wa.me/573016729250?text=")).toBe(true);
    const text = decodeURIComponent(links!.whatsappUrl.split("?text=")[1]);
    expect(text).toContain("FX (económico)");
    expect(text).toContain("Armenia Aeropuerto");
    expect(text).toContain("2026-08-01 12:00 → 2026-08-08 12:00");
    expect(text).toContain("Diego Melo");
    expect(text).toContain("CC 1020304050");
    expect(text).toContain("diego@example.com");
    expect(text).toContain("573001112233");
  });

  it("returns null when the sede code is not in the directory", () => {
    const other = encodeQuote({
      pickupLocation: "ZZZZZ",
      returnLocation: "ZZZZZ",
      pickupDateTime: "2026-08-01T12:00:00",
      returnDateTime: "2026-08-08T12:00:00",
      selected_days: 7,
      categoryCode: "FX",
      referenceToken: "r",
      rateQualifier: "q",
      total_price: 1,
      total_price_to_pay: 1,
      tax_fee: 0,
      iva_fee: 0,
      coverage_days: 0,
      coverage_price: 0,
      return_fee: 0,
      extra_hours: 0,
      extra_hours_price: 0,
    });
    expect(buildFallbackLinks({ brand: "alquilatucarro", quote: other, customer }, directory)).toBeNull();
  });

  it("returns null when the quote cannot be decoded", () => {
    expect(
      buildFallbackLinks({ brand: "alquilatucarro", quote: "not-a-quote", customer }, directory),
    ).toBeNull();
  });
});

describe("buildOnDemandLinks", () => {
  it("reuses the SAME webUrl as the fallback but a neutral WhatsApp message", () => {
    const fallback = buildFallbackLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    const onDemand = buildOnDemandLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    expect(onDemand?.webUrl).toBe(fallback?.webUrl);

    const text = decodeURIComponent(onDemand!.whatsappUrl.split("?text=")[1]);
    expect(text).not.toContain("no se pudo");
    expect(text).toContain("quiero reservar");
    // Reservation fields still present.
    expect(text).toContain("FX (económico)");
    expect(text).toContain("Armenia Aeropuerto");
    expect(text).toContain("Diego Melo");
  });

  it("omits customer lines that are still empty (no 'undefined')", () => {
    const onDemand = buildOnDemandLinks(
      {
        brand: "alquilatucarro",
        quote,
        gamaDescripcion: "económico",
        customer: { fullname: "", identification_type: "", identification: "", email: "", phone: "" },
      },
      directory,
    );
    const text = decodeURIComponent(onDemand!.whatsappUrl.split("?text=")[1]);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Nombre:");
    expect(text).not.toContain("Documento:");
    expect(text).not.toContain("Correo:");
    expect(text).not.toContain("Teléfono:");
    // The gama/sede/fechas header lines stay.
    expect(text).toContain("Gama: FX (económico)");
    expect(text).toContain("Sede: Armenia Aeropuerto");
  });

  it("returns null when the quote cannot be decoded", () => {
    expect(
      buildOnDemandLinks({ brand: "alquilatucarro", quote: "nope", customer }, directory),
    ).toBeNull();
  });
});

describe("buildSelfServeLinks (P3)", () => {
  it("reuses the SAME webUrl and a numberless share wa.me with the quote + deep-link", () => {
    const onDemand = buildOnDemandLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    const self = buildSelfServeLinks(
      {
        brand: "alquilatucarro",
        quote,
        gamaDescripcion: "económico",
        precioTotal: 1261569,
        customer,
      },
      directory,
    );
    expect(self?.webUrl).toBe(onDemand?.webUrl);
    // Numberless share → WhatsApp opens the contact picker.
    expect(self?.shareUrl.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(self!.shareUrl.split("?text=")[1]);
    expect(text).toContain("FX (económico)");
    expect(text).toContain("Armenia Aeropuerto");
    expect(text).toContain("$1.261.569");
    expect(text).toContain(self!.webUrl); // recipient can book straight from the message
  });

  it("omits the price line when no precioTotal is given", () => {
    const self = buildSelfServeLinks(
      { brand: "alquilatucarro", quote, gamaDescripcion: "económico", customer },
      directory,
    );
    const text = decodeURIComponent(self!.shareUrl.split("?text=")[1]);
    expect(text).not.toContain("Total:");
  });

  it("returns null when the quote cannot be decoded", () => {
    expect(
      buildSelfServeLinks({ brand: "alquilatucarro", quote: "nope", customer }, directory),
    ).toBeNull();
  });
});
