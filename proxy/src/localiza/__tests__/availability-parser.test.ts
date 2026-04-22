import { describe, it, expect } from "vitest";
import { extractAvailability } from "../availability";

type FeeFixture = {
  attrs: Record<string, string>;
  calculation?: Record<string, string>;
};

function buildResponse(fees: Array<Record<string, string> | FeeFixture>) {
  const normalizedFees = fees.map((fee) => {
    const fixture = "attrs" in fee ? fee : { attrs: fee };
    const node: Record<string, unknown> = { $: fixture.attrs };
    if (fixture.calculation) node.Calculation = { $: fixture.calculation };
    return node;
  });

  return {
    Envelope: {
      Body: {
        OTA_VehAvailRateResponse: {
          OTA_VehAvailRateRS: {
            VehAvailRSCore: {
              VehVendorAvails: {
                VehVendorAvail: [
                  {
                    VehAvails: {
                      VehAvail: [
                        {
                          VehAvailCore: {
                            Vehicle: { $: { Code: "CX", Description: "Gama CX" } },
                            RentalRate: {
                              VehicleCharges: {
                                VehicleCharge: [
                                  {
                                    $: { Purpose: "1" },
                                    Calculation: {
                                      $: { UnitCharge: "100000", Quantity: "3" },
                                    },
                                  },
                                ],
                              },
                              RateQualifier: { $: { RateQualifier: "RQ" } },
                            },
                            TotalCharge: {
                              $: {
                                RateTotalAmount: "300000",
                                EstimatedTotalAmount: "450000",
                              },
                            },
                            Reference: { $: { ID: "ref-1" } },
                            Fees: {
                              Fee: normalizedFees,
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

describe("extractAvailability — returnFeeAmount", () => {
  it("reads returnFeeAmount from the Fee whose Description is 'Taxa de retorno'", () => {
    const parsed = buildResponse([
      { Description: "Taxa", Amount: "49060", Purpose: "6" },
      { Description: "Taxa de retorno", Amount: "125442", Purpose: "2" },
      { Description: "IVA", Amount: "102536", Purpose: "7" },
    ]);
    const [first] = extractAvailability(parsed);
    expect(first.returnFeeAmount).toBe(125442);
  });

  it("returns 0 when the response has no 'Taxa de retorno' fee (same pickup/return)", () => {
    const parsed = buildResponse([
      { Description: "Taxa", Amount: "49060", Purpose: "6" },
      { Description: "IVA", Amount: "102536", Purpose: "7" },
    ]);
    const [first] = extractAvailability(parsed);
    expect(first.returnFeeAmount).toBe(0);
  });

  it("does not rely on Purpose='38' (legacy assumption that never matched Localiza)", () => {
    const parsed = buildResponse([
      { Description: "Algo distinto", Amount: "99999", Purpose: "38" },
    ]);
    const [first] = extractAvailability(parsed);
    expect(first.returnFeeAmount).toBe(0);
  });
});

describe("extractAvailability — taxFeePercentage", () => {
  it("reads taxFeePercentage from Calculation on the Fee with Purpose='6'", () => {
    const parsed = buildResponse([
      {
        attrs: { Description: "Taxa", Amount: "49060", Purpose: "6" },
        calculation: { Percentage: "10", Total: "49060" },
      },
      { Description: "IVA", Amount: "102536", Purpose: "7" },
    ]);
    const [first] = extractAvailability(parsed);
    expect(first.taxFeePercentage).toBe(10);
    expect(first.taxFeeAmount).toBe(49060);
  });

  it("returns 0 when the Taxa Fee has no Calculation subnode", () => {
    const parsed = buildResponse([
      { Description: "Taxa", Amount: "49060", Purpose: "6" },
    ]);
    const [first] = extractAvailability(parsed);
    expect(first.taxFeePercentage).toBe(0);
  });
});
