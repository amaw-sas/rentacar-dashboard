import { describe, it, expect } from "vitest";
import { buildVehAvailRateXML, buildVehResXML } from "../../../proxy/src/localiza/xml-templates";

describe("buildVehAvailRateXML", () => {
  it("builds valid SOAP XML with OTA_VehAvailRateRQ", () => {
    const xml = buildVehAvailRateXML({
      token: "test-token-123",
      requestorId: "AGENCY1",
      pickupLocation: "AABOT",
      returnLocation: "AABOT",
      pickupDateTime: "2026-04-01T09:00:00",
      returnDateTime: "2026-04-05T09:00:00",
    });
    expect(xml).toContain("OTA_VehAvailRateRQ");
    expect(xml).toContain('EchoToken="test-token-123"');
    expect(xml).toContain('ID="AGENCY1"');
    expect(xml).toContain('LocationCode="AABOT"');
    expect(xml).toContain('PickUpDateTime="2026-04-01T09:00:00"');
    expect(xml).toContain('ReturnDateTime="2026-04-05T09:00:00"');
  });
});

describe("buildVehResXML", () => {
  it("builds valid SOAP XML with OTA_VehResRQ", () => {
    const xml = buildVehResXML({
      token: "test-token-123",
      requestorId: "AGENCY1",
      pickupLocation: "AABOT",
      returnLocation: "ACBOT",
      pickupDateTime: "2026-04-01T09:00:00",
      returnDateTime: "2026-04-05T09:00:00",
      categoryCode: "C",
      referenceToken: "ref-abc-123",
      rateQualifier: "STANDARD",
      customerName: "Juan Perez",
      customerEmail: "juan@example.com",
      customerPhone: "3001234567",
      customerPhoneCountryCode: "57",
      customerDocument: "1234567890",
      customerDocumentType: "5",
    });
    expect(xml).toContain("OTA_VehResRQ");
    expect(xml).toContain('EchoToken="test-token-123"');
    expect(xml).toContain("Juan Perez</ns:Surname>");
    expect(xml).toContain("juan@example.com</ns:Email>");
    expect(xml).toContain('PhoneNumber="3001234567"');
    expect(xml).toContain('CountryCode="57"');
    expect(xml).toContain('ID="ref-abc-123"');
    expect(xml).toContain('RateQualifier="STANDARD"');
    expect(xml).toContain('Code="C"');
    expect(xml).toContain('PaymentType="2"');
    expect(xml).toContain('Type="41"');
  });
});
