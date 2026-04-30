import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ReservedClientEmail } from "@/lib/email/templates/reserved-confirmation";

// Scenario: client receives a reservation email with a franchise logo.
// Some email clients (e.g., Thunderbird) ignore HTML width/height attributes
// and fall back to the image's natural dimensions, blowing out the 560px
// container. The inline style must explicitly bound height, width:auto, and a
// max-width safety cap so the logo renders consistently across clients.

const baseProps = {
  franchiseName: "Alquilatucarro",
  franchiseColor: "#0055a5",
  franchiseWebsite: "https://alquilatucarro.co",
  franchisePhone: "3002436677",
  franchiseLogo: "https://example.com/logo.png",
  customerName: "Juan Perez",
  categoryName: "Gama C Económico",
  pickupLocation: "Bogotá Aeropuerto",
  pickupDate: "15 de mayo 2026",
  pickupHour: "9:00 AM",
  returnLocation: "Bogotá Aeropuerto",
  returnDate: "16 de mayo 2026",
  returnHour: "9:00 AM",
  selectedDays: 1,
  reserveCode: "AVO2XUK5EU",
  totalPrice: 100000,
  taxFee: 0,
  ivaFee: 0,
  totalPriceToPay: 100000,
  totalInsurance: false,
  extraDriver: false,
  babySeat: false,
  wash: false,
  extraDriverDayPrice: 0,
  washPrice: 0,
  washOnsitePrice: 0,
  washDeepPrice: 0,
  washDeepUpholsteryPrice: 0,
};

function extractImgTags(html: string): string[] {
  return html.match(/<img\b[^>]*>/gi) ?? [];
}

function findLogoImgs(html: string, src: string): string[] {
  const tags = extractImgTags(html);
  const matches = tags.filter((tag) => tag.includes(`src="${src}"`));
  if (matches.length === 0) {
    throw new Error(`no logo <img> with src=${src} found`);
  }
  return matches;
}

function findHeaderLogo(html: string, src: string): string {
  // Header logo lacks "opacity" (footer logo has opacity:0.7)
  const imgs = findLogoImgs(html, src);
  const header = imgs.find((tag) => !/opacity/i.test(tag));
  if (!header) throw new Error("header logo <img> not found");
  return header;
}

function findFooterLogo(html: string, src: string): string {
  const imgs = findLogoImgs(html, src);
  const footer = imgs.find((tag) => /opacity/i.test(tag));
  if (!footer) throw new Error("footer logo <img> not found");
  return footer;
}

describe("EmailLayout — franchise logo sizing", () => {
  it("header logo has explicit inline height in px (not just HTML attribute)", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findHeaderLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*height:\s*44px/i);
  });

  it("header logo declares width:auto inline so natural width cannot leak through", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findHeaderLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*width:\s*auto/i);
  });

  it("header logo declares a max-width safety cap to prevent overflow of the 560px container", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findHeaderLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*max-width:\s*\d+px/i);
  });

  it("footer logo has explicit inline height in px", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findFooterLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*height:\s*28px/i);
  });

  it("footer logo declares width:auto inline so natural width cannot leak through", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findFooterLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*width:\s*auto/i);
  });

  it("footer logo declares a max-width safety cap", async () => {
    const html = await render(ReservedClientEmail(baseProps));
    const img = findFooterLogo(html, baseProps.franchiseLogo);
    expect(img).toMatch(/style="[^"]*max-width:\s*\d+px/i);
  });
});
