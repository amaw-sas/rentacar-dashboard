import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LOCALIZA_WARNING_MAP,
  LocalizaWarningError,
  buildLocalizaWarning,
  extractErrorMessage,
  extractWarningShortText,
} from "../warnings";

describe("extractWarningShortText", () => {
  it("reads ShortText when Warning is a single object (xml2js explicitArray:false)", () => {
    const warnings = { Warning: { $: { ShortText: "LLNRAG017", Type: "11" } } };
    expect(extractWarningShortText(warnings)).toBe("LLNRAG017");
  });

  it("reads the first ShortText when Warning is an array", () => {
    const warnings = {
      Warning: [
        { $: { ShortText: "LLNRAG009" } },
        { $: { ShortText: "LLNRAG013" } },
      ],
    };
    expect(extractWarningShortText(warnings)).toBe("LLNRAG009");
  });

  it("returns null when there is no Warning node", () => {
    expect(extractWarningShortText({})).toBeNull();
    expect(extractWarningShortText(null)).toBeNull();
    expect(extractWarningShortText(undefined)).toBeNull();
  });

  it("returns null when Warning has no attributes or no ShortText", () => {
    expect(extractWarningShortText({ Warning: {} })).toBeNull();
    expect(extractWarningShortText({ Warning: { $: {} } })).toBeNull();
    expect(extractWarningShortText({ Warning: { $: { Type: "11" } } })).toBeNull();
  });
});

describe("extractErrorMessage", () => {
  it("reads text content from Error._ (xml2js tag text)", () => {
    const errors = { Error: { _: "Unexpected upstream failure", $: {} } };
    expect(extractErrorMessage(errors)).toBe("Unexpected upstream failure");
  });

  it("falls back to attribute ShortText when no _ text", () => {
    const errors = { Error: { $: { ShortText: "LLGEN001" } } };
    expect(extractErrorMessage(errors)).toBe("LLGEN001");
  });

  it("returns null when Errors is missing", () => {
    expect(extractErrorMessage(undefined)).toBeNull();
  });
});

describe("buildLocalizaWarning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each([
    ["LLNRRE002", "inferior_pickup_date"],
    ["LLNRAG009", "no_available_categories_error"],
    ["LLNRRE010", "same_hour_error"],
    ["LLNRAG011", "out_of_schedule_pickup_hour_error"],
    ["LLNRAG012", "holiday_pickup_date_error"],
    ["LLNRAG013", "out_of_schedule_pickup_date_error"],
    ["LLNRAG014", "holiday_out_of_schedule_return_date_error"],
    ["LLNRAG015", "out_of_schedule_return_hour_error"],
    ["LLNRAG016", "holiday_return_date_error"],
    ["LLNRAG017", "out_of_schedule_return_date_error"],
    ["LLNRRE045", "reservation_cancelled_error"],
  ])("maps %s → %s with status 500 and preserves shortText", (shortText, code) => {
    const err = buildLocalizaWarning(shortText);
    expect(err).toBeInstanceOf(LocalizaWarningError);
    expect(err.code).toBe(code);
    expect(err.httpStatus).toBe(500);
    expect(err.shortText).toBe(shortText);
    expect(err.message).toBe(LOCALIZA_WARNING_MAP[shortText].message);
  });

  it("falls back to unknown_error when ShortText is not in the map", () => {
    const err = buildLocalizaWarning("LLNRAG999");
    expect(err.code).toBe("unknown_error");
    expect(err.httpStatus).toBe(500);
    expect(err.shortText).toBe("LLNRAG999");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("localiza_warning_unmapped");
    expect(logged.shortText).toBe("LLNRAG999");
  });

  it("falls back to unknown_error when shortText is null", () => {
    const err = buildLocalizaWarning(null);
    expect(err.code).toBe("unknown_error");
    expect(err.shortText).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("LocalizaWarningError.toJSON", () => {
  it("serializes to the {error, message, shortText} contract the client expects", () => {
    const err = buildLocalizaWarning("LLNRAG017");
    expect(err.toJSON()).toEqual({
      error: "out_of_schedule_return_date_error",
      message:
        "El día de devolución está por fuera del horario de atención de la sede seleccionada",
      shortText: "LLNRAG017",
    });
  });
});
