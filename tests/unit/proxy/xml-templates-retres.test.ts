import { describe, it, expect } from "vitest";
import { buildVehRetResXML } from "../../../proxy/src/localiza/xml-templates";

describe("buildVehRetResXML", () => {
  it("builds valid SOAP XML with OTA_VehRetResRQ", () => {
    const xml = buildVehRetResXML("test-token-123", "AV78XC3JDA");
    expect(xml).toContain("OTA_VehRetResRQ");
    expect(xml).toContain('EchoToken="test-token-123"');
    expect(xml).toContain('Type="14"');
    expect(xml).toContain('ID="AV78XC3JDA"');
  });

  it("includes reservation code as UniqueID", () => {
    const xml = buildVehRetResXML("token", "AVA5XBK63KA");
    expect(xml).toContain('ID="AVA5XBK63KA"');
  });
});
