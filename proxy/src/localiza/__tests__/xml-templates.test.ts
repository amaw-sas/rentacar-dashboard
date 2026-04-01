import { describe, it, expect } from "vitest";
import { buildVehAvailRateXML } from "../xml-templates";

describe("buildVehAvailRateXML", () => {
  it("generates XML matching Localiza SOAP envelope structure", () => {
    const xml = buildVehAvailRateXML({
      token: "test-token",
      requestorId: "test-requestor",
      pickupLocation: "AABOT",
      returnLocation: "AABOT",
      pickupDateTime: "2026-04-05T10:00:00",
      returnDateTime: "2026-04-08T10:00:00",
    });

    // Must use s: namespace prefix (not soap:)
    expect(xml).toContain('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">');
    // Must wrap in OTA_VehAvailRate with tempuri namespace
    expect(xml).toContain('<OTA_VehAvailRate');
    expect(xml).toContain('xmlns="http://tempuri.org/"');
    // Must include required OTA attributes
    expect(xml).toContain('EchoToken="test-token"');
    expect(xml).toContain('PrimaryLangID="esp"');
    expect(xml).toContain('Version="0"');
    expect(xml).toContain('MaxPerVendorInd="false"');
    // DateTime must be attributes of VehRentalCore, not child elements
    expect(xml).toContain('PickUpDateTime="2026-04-05T10:00:00"');
    expect(xml).toContain('ReturnDateTime="2026-04-08T10:00:00"');
    // Location must include CodeContext
    expect(xml).toContain('CodeContext="internal code"');
    // Must include Customer with CitizenCountryName CO
    expect(xml).toContain("<CitizenCountryName");
    expect(xml).toContain('Code="CO"');
    // RequestorID must have its own OTA namespace
    expect(xml).toContain('ID="test-requestor"');
    expect(xml).toContain('Type="5"');
  });
});
