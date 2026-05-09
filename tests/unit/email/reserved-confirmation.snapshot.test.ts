import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { JSDOM } from "jsdom";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-confirmation";

const FRANCHISE_HEX = "#0055a5";

type Props = Parameters<typeof ReservedClientEmail>[0];

const baseProps: Props = {
  franchiseName: "Alquilatucarro",
  franchiseColor: FRANCHISE_HEX,
  franchiseWebsite: "https://alquilatucarro.co",
  franchisePhone: "3002436677",
  customerName: "Juan Perez",
  categoryName: "Gama C Económico",
  pickupLocation: "Bogotá Aeropuerto",
  pickupAddress: "Aeropuerto El Dorado, Piso 1 Puerta 7",
  pickupMapUrl: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
  pickupDate: "15 de mayo 2026",
  pickupHour: "9:00 AM",
  returnLocation: "Bogotá Aeropuerto",
  returnAddress: "Aeropuerto El Dorado, Piso 1 Puerta 7",
  returnMapUrl: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
  returnDate: "20 de mayo 2026",
  returnHour: "9:00 AM",
  selectedDays: 5,
  reserveCode: "ABC123",
  totalPrice: 1_000_000,
  taxFee: 100_000,
  ivaFee: 190_000,
  totalPriceToPay: 1_290_000,
  totalInsurance: false,
  extraDriver: false,
  babySeat: false,
  wash: false,
  extraDriverDayPrice: 12000,
  washPrice: 20000,
  washOnsitePrice: 30000,
  washDeepPrice: 150000,
  washDeepUpholsteryPrice: 225000,
};

async function renderDom(props: Props) {
  const html = await render(ReservedClientEmail(props));
  const dom = new JSDOM(html);
  return dom.window.document;
}

function mapsAnchors(doc: Document): HTMLAnchorElement[] {
  return Array.from(doc.querySelectorAll('a[href^="https://maps."]')) as HTMLAnchorElement[];
}

/**
 * Walk every element; collect any declared pixel width that exceeds the limit.
 * Inspects inline style `width:` / `max-width:` and the HTML `width="N"` attribute
 * (which is always pixels for tables). Ignores `%`, `em`, `rem` (container-relative
 * — cannot exceed parent). Returns offending elements for diagnostic clarity.
 */
function elementsExceedingDeclaredWidth(doc: Document, limitPx: number): string[] {
  const offenders: string[] = [];
  doc.querySelectorAll("*").forEach((el) => {
    const style = el.getAttribute("style") ?? "";
    const widthAttr = el.getAttribute("width");

    const styleMatches = [
      ...style.matchAll(/(?:^|;)\s*(?:max-)?width\s*:\s*(\d+(?:\.\d+)?)(px)?\s*(?:;|$)/gi),
    ];
    for (const m of styleMatches) {
      const n = parseFloat(m[1]);
      if (n > limitPx) {
        offenders.push(`${el.tagName.toLowerCase()} style=${m[0].trim()}`);
      }
    }

    if (widthAttr && /^\d+$/.test(widthAttr)) {
      const n = parseInt(widthAttr, 10);
      if (n > limitPx) {
        offenders.push(`${el.tagName.toLowerCase()} width="${widthAttr}"`);
      }
    }
  });
  return offenders;
}

describe("ReservedClientEmail — structural snapshot", () => {
  describe("Fixture A — same pickup/return location", () => {
    it("renders 2 Maps anchors with matching href, target, rel, aria-label, and inline-style substrings", async () => {
      const doc = await renderDom(baseProps);
      const anchors = mapsAnchors(doc);
      expect(anchors).toHaveLength(2);

      for (const a of anchors) {
        expect(a.getAttribute("href")).toBe(baseProps.pickupMapUrl);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
        expect(a.getAttribute("aria-label")).toContain(baseProps.pickupLocation);

        const style = a.getAttribute("style") ?? "";
        expect(style).toMatch(/padding\s*:\s*12px\s+18px/);
        expect(style).toMatch(/border-radius\s*:\s*6px/);
        expect(style.toLowerCase()).toContain(FRANCHISE_HEX.toLowerCase());
      }
    });

    it("address text appears once per Dirección row (2 occurrences total)", async () => {
      const doc = await renderDom(baseProps);
      const occurrences = (
        doc.body.textContent?.match(/Aeropuerto El Dorado, Piso 1 Puerta 7/g) ?? []
      ).length;
      expect(occurrences).toBe(2);
    });

    it("no element declares an inline width or width-attribute exceeding 320px", async () => {
      const doc = await renderDom(baseProps);
      const offenders = elementsExceedingDeclaredWidth(doc, 320);
      // EmailLayout uses max-width:560px on the email container — that's intentional
      // for desktop. We only fail on UNEXPECTED widths above 320px. Allow the known
      // 560px container by filtering it out.
      const unexpected = offenders.filter((o) => !/max-width:\s*560/i.test(o));
      expect(unexpected).toEqual([]);
    });
  });

  describe("Fixture B — distinct pickup/return locations with explicit return_*", () => {
    const distinctProps = {
      ...baseProps,
      pickupLocation: "Aeropuerto El Dorado",
      pickupAddress: "Aeropuerto El Dorado, Piso 1 Puerta 7",
      pickupMapUrl: "https://maps.app.goo.gl/U3Sct9jNM8BrLFR78",
      returnLocation: "Punto Diagonal 24C",
      returnAddress: "Diagonal 24C, 99-45 - a 5 minutos del Aeropuerto",
      returnMapUrl: "https://maps.app.goo.gl/JjpsSCHkCrgGYa9P7",
    };

    it("pickup and return anchors have different href values, each aria-label matches its location", async () => {
      const doc = await renderDom(distinctProps);
      const anchors = mapsAnchors(doc);
      expect(anchors).toHaveLength(2);

      const hrefs = anchors.map((a) => a.getAttribute("href"));
      expect(hrefs[0]).toBe(distinctProps.pickupMapUrl);
      expect(hrefs[1]).toBe(distinctProps.returnMapUrl);
      expect(hrefs[0]).not.toBe(hrefs[1]);

      expect(anchors[0].getAttribute("aria-label")).toContain(distinctProps.pickupLocation);
      expect(anchors[1].getAttribute("aria-label")).toContain(distinctProps.returnLocation);
    });

    it("both addresses appear exactly once, neither leaks into the other row", async () => {
      const doc = await renderDom(distinctProps);
      const text = doc.body.textContent ?? "";
      expect((text.match(/Aeropuerto El Dorado, Piso 1 Puerta 7/g) ?? []).length).toBe(1);
      expect((text.match(/Diagonal 24C, 99-45/g) ?? []).length).toBe(1);
    });
  });

  describe("Fixture C — malformed pickupMapUrl filtered upstream (undefined)", () => {
    it("zero Maps anchors render for pickup row, return anchor still present, address text still rendered", async () => {
      const doc = await renderDom({
        ...baseProps,
        pickupMapUrl: undefined,
      });

      const anchors = mapsAnchors(doc);
      expect(anchors).toHaveLength(1);

      // The single remaining anchor must be the RETURN one (its aria-label names the return location)
      expect(anchors[0].getAttribute("aria-label")).toContain(baseProps.returnLocation);

      // Address text still rendered for both pickup and return (1+1)
      const occurrences = (
        doc.body.textContent?.match(/Aeropuerto El Dorado, Piso 1 Puerta 7/g) ?? []
      ).length;
      expect(occurrences).toBe(2);
    });
  });
});
