import { Router, Request, Response } from "express";
import { callLocalizaAPI, getConfig } from "./client";
import { buildVehAvailRateXML } from "./xml-templates";
import {
  LocalizaWarningError,
  buildLocalizaWarning,
  extractErrorMessage,
  extractWarningShortText,
} from "./warnings";

const router = Router();

interface AvailabilityRequest {
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
}

export function extractAvailability(parsed: Record<string, unknown>): Record<string, unknown>[] {
  try {
    const envelope = parsed["Envelope"] as Record<string, unknown>;
    const body = envelope["Body"] as Record<string, unknown>;
    // Localiza wraps response in OTA_VehAvailRateResponse
    const wrapper = (body["OTA_VehAvailRateResponse"] || body) as Record<string, unknown>;
    const rs = (wrapper["OTA_VehAvailRateRS"] || body["OTA_VehAvailRateRS"]) as Record<string, unknown>;

    if (!rs) {
      console.warn("Localiza response missing OTA_VehAvailRateRS");
      return [];
    }

    // Localiza emits <Warnings><Warning ShortText="CODE"/></Warnings> instead
    // of availability data when it rejects the query for business reasons
    // (out-of-schedule, holiday, no inventory). Propagate the structured code
    // so the Nuxt client can render the matching toast via useMessages.
    if (rs["Warnings"]) {
      throw buildLocalizaWarning(extractWarningShortText(rs["Warnings"]));
    }

    if (rs["Errors"]) {
      const upstreamMessage = extractErrorMessage(rs["Errors"]);
      console.error("Localiza API error:", upstreamMessage);
      throw buildLocalizaWarning(null);
    }

    const core = rs["VehAvailRSCore"] as Record<string, unknown>;
    if (!core) {
      console.warn("Localiza response missing VehAvailRSCore");
      return [];
    }
    const vendorAvails = core["VehVendorAvails"] as Record<string, unknown>;
    if (!vendorAvails) {
      console.warn("Localiza response missing VehVendorAvails");
      return [];
    }

    // VehVendorAvail is an array of vendors, collect all VehAvails from each
    let vendorAvailList = vendorAvails["VehVendorAvail"];
    if (!Array.isArray(vendorAvailList)) vendorAvailList = vendorAvailList ? [vendorAvailList] : [];

    const allAvails: Record<string, unknown>[] = [];
    for (const vendor of vendorAvailList as Record<string, unknown>[]) {
      const vehAvails = vendor["VehAvails"];
      if (!vehAvails) continue;
      let availItems = (vehAvails as Record<string, unknown>)["VehAvail"];
      if (!availItems) continue;
      if (!Array.isArray(availItems)) availItems = [availItems];
      allAvails.push(...(availItems as Record<string, unknown>[]));
    }

    const avails: unknown[] = allAvails;

    const attr = (obj: unknown, field: string): string => {
      if (!obj || typeof obj !== "object") return "";
      return (((obj as Record<string, unknown>)["$"] as Record<string, string>) || {})[field] || "";
    };

    const calc = (charge: unknown, field: string): number => {
      if (!charge || typeof charge !== "object") return 0;
      const c = (charge as Record<string, unknown>)["Calculation"] as Record<string, unknown> | undefined;
      return c ? parseFloat(((c["$"] as Record<string, string>) || {})[field] || "0") : 0;
    };

    return (avails as Record<string, unknown>[]).map((avail) => {
      // avail is already a VehAvail node
      const vac = avail["VehAvailCore"] as Record<string, unknown>;
      const vehicle = vac["Vehicle"];
      const rentalRate = vac["RentalRate"] as Record<string, unknown>;
      const totalCharge = vac["TotalCharge"];
      const reference = vac["Reference"];
      const rateQual = rentalRate["RateQualifier"];

      let vehicleCharges = (rentalRate["VehicleCharges"] as Record<string, unknown>)?.["VehicleCharge"];
      if (!Array.isArray(vehicleCharges)) vehicleCharges = vehicleCharges ? [vehicleCharges] : [];

      const dailyCharge = (vehicleCharges as Record<string, unknown>[]).find(
        (c) => attr(c, "Purpose") === "1",
      );
      const extraHoursCharge = (vehicleCharges as Record<string, unknown>[]).find(
        (c) => attr(c, "Purpose") === "11",
      );

      let feeList: unknown[] = [];
      const fees = vac["Fees"] as Record<string, unknown> | undefined;
      if (fees) {
        const fl = fees["Fee"];
        feeList = Array.isArray(fl) ? fl : fl ? [fl] : [];
      }
      const taxFee = feeList.find((f) => attr(f, "Purpose") === "6");
      const ivaFee = feeList.find((f) => attr(f, "Purpose") === "7");
      const returnFee = feeList.find(
        (f) => attr(f, "Description") === "Taxa de retorno",
      );

      const availInfo = avail["VehAvailInfo"] as Record<string, unknown> | undefined;
      let coverages: unknown[] = [];
      if (availInfo?.["PricedCoverages"]) {
        const cl = (availInfo["PricedCoverages"] as Record<string, unknown>)["PricedCoverage"];
        coverages = Array.isArray(cl) ? cl : cl ? [cl] : [];
      }
      const basicCoverage = coverages.find((c) => {
        const cov = (c as Record<string, unknown>)["Coverage"];
        return attr(cov, "CoverageType") === "7";
      });
      const coverageCharge = basicCoverage ? (basicCoverage as Record<string, unknown>)["Charge"] : null;

      let discounts: unknown[] = [];
      if (vac["Discount"]) {
        const dl = vac["Discount"];
        discounts = Array.isArray(dl) ? dl : [dl];
      }

      return {
        categoryCode: attr(vehicle, "Code"),
        categoryDescription: attr(vehicle, "Description"),
        totalAmount: parseFloat(attr(totalCharge, "RateTotalAmount") || "0"),
        estimatedTotalAmount: parseFloat(attr(totalCharge, "EstimatedTotalAmount") || "0"),
        vehicleDayCharge: calc(dailyCharge, "UnitCharge"),
        numberDays: parseInt(String(calc(dailyCharge, "Quantity"))) || 0,
        coverageUnitCharge: calc(coverageCharge, "UnitCharge"),
        coverageQuantity: parseInt(String(calc(coverageCharge, "Quantity"))) || 0,
        coverageTotalAmount: calc(coverageCharge, "Total"),
        extraHoursQuantity: parseInt(String(calc(extraHoursCharge, "Quantity"))) || 0,
        extraHoursUnityAmount: calc(extraHoursCharge, "UnitCharge"),
        extraHoursTotalAmount: calc(extraHoursCharge, "Total"),
        taxFeeAmount: parseFloat(attr(taxFee, "Amount") || "0"),
        // Percentage lives in the Calculation subnode, not as a Fee attribute.
        taxFeePercentage: calc(taxFee, "Percentage"),
        IVAFeeAmount: parseFloat(attr(ivaFee, "Amount") || "0"),
        returnFeeAmount: parseFloat(attr(returnFee, "Amount") || "0"),
        discountAmount: discounts[0] ? parseFloat(attr(discounts[0], "Amount") || "0") : 0,
        discountPercentage: discounts[0] ? parseFloat(attr(discounts[0], "Percent") || "0") : 0,
        rateQualifier: attr(rateQual, "RateQualifier"),
        referenceToken: attr(reference, "ID"),
      };
    });
  } catch (error) {
    if (error instanceof LocalizaWarningError) throw error;
    console.error("Error parsing availability response:", error);
    return [];
  }
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { pickupLocation, returnLocation, pickupDateTime, returnDateTime } =
    req.body as AvailabilityRequest;

  if (!pickupLocation || !returnLocation || !pickupDateTime || !returnDateTime) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    const config = getConfig();
    const xml = buildVehAvailRateXML({
      token: config.token,
      requestorId: config.requestorId,
      pickupLocation,
      returnLocation,
      pickupDateTime,
      returnDateTime,
    });

    const parsed = await callLocalizaAPI(
      "http://www.opentravel.org/OTA/2003/05:OTA_VehAvailRateRQ",
      xml,
    );

    const vehicles = extractAvailability(parsed);
    res.json(vehicles);
  } catch (error) {
    if (error instanceof LocalizaWarningError) {
      res.status(error.httpStatus).json(error.toJSON());
      return;
    }
    console.error("Availability error:", error);
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
