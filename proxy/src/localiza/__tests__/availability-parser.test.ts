import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractAvailability } from "../availability";
import { LocalizaWarningError } from "../warnings";

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

describe("extractAvailability — defensive parsing", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function buildWarningResponse(shortText: string) {
    return {
      Envelope: {
        Body: {
          OTA_VehAvailRateResponse: {
            OTA_VehAvailRateRS: {
              Warnings: {
                Warning: { $: { ShortText: shortText, Type: "11" } },
              },
            },
          },
        },
      },
    };
  }

  it("throws LocalizaWarningError for LLNRAG017 (out-of-schedule return date)", () => {
    // This is the bug reported in production: Localiza rejects by return-date
    // schedule, proxy used to silently return [] — client saw "no cars" instead
    // of the real toast message. Now the warning must propagate with a code.
    const parsed = buildWarningResponse("LLNRAG017");
    expect(() => extractAvailability(parsed)).toThrowError(LocalizaWarningError);
    try {
      extractAvailability(parsed);
    } catch (e) {
      const err = e as LocalizaWarningError;
      expect(err.code).toBe("out_of_schedule_return_date_error");
      expect(err.shortText).toBe("LLNRAG017");
      expect(err.httpStatus).toBe(500);
    }
  });

  it("throws LocalizaWarningError for LLNRAG009 (no available categories)", () => {
    // Preserved for the "directive" UX case — the code still flows to the
    // client, which differentiates it in useStoreSearchData and shows the
    // "¡Oops! sin carritos" inline message instead of a toast.
    const parsed = buildWarningResponse("LLNRAG009");
    try {
      extractAvailability(parsed);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalizaWarningError);
      expect((e as LocalizaWarningError).code).toBe(
        "no_available_categories_error",
      );
    }
  });

  it("throws LocalizaWarningError with unknown_error fallback for unmapped ShortText", () => {
    const parsed = buildWarningResponse("LLNRAG999");
    try {
      extractAvailability(parsed);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalizaWarningError);
      expect((e as LocalizaWarningError).code).toBe("unknown_error");
      expect((e as LocalizaWarningError).shortText).toBe("LLNRAG999");
    }
  });

  it("returns [] when OTA_VehAvailRateRS is missing VehAvailRSCore entirely", () => {
    const parsed = {
      Envelope: {
        Body: {
          OTA_VehAvailRateResponse: {
            OTA_VehAvailRateRS: {},
          },
        },
      },
    };
    expect(() => extractAvailability(parsed)).not.toThrow();
    expect(extractAvailability(parsed)).toEqual([]);
    // Expected: warn at warn-level about missing VehAvailRSCore; NOT caught as unexpected error.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("VehAvailRSCore"),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns [] when VehAvailRSCore is present but VehVendorAvails is missing", () => {
    const parsed = {
      Envelope: {
        Body: {
          OTA_VehAvailRateResponse: {
            OTA_VehAvailRateRS: {
              VehAvailRSCore: {},
            },
          },
        },
      },
    };
    expect(() => extractAvailability(parsed)).not.toThrow();
    expect(extractAvailability(parsed)).toEqual([]);
    // Expected: warn at warn-level about missing VehVendorAvails; NOT caught as unexpected error.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("VehVendorAvails"),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
