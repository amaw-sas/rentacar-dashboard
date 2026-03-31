"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("./client");
const xml_templates_1 = require("./xml-templates");
const router = (0, express_1.Router)();
function extractAvailability(parsed) {
    try {
        const envelope = parsed["Envelope"];
        const body = envelope["Body"];
        const rs = body["OTA_VehAvailRateRS"];
        const core = rs["VehAvailRSCore"];
        const vendorAvails = core["VehVendorAvails"];
        let avails = vendorAvails["VehAvails"];
        if (!Array.isArray(avails))
            avails = avails ? [avails] : [];
        const attr = (obj, field) => {
            if (!obj || typeof obj !== "object")
                return "";
            return (obj["$"] || {})[field] || "";
        };
        const calc = (charge, field) => {
            if (!charge || typeof charge !== "object")
                return 0;
            const c = charge["Calculation"];
            return c ? parseFloat((c["$"] || {})[field] || "0") : 0;
        };
        return avails.map((avail) => {
            const va = avail["VehAvail"];
            const vac = va["VehAvailCore"];
            const vehicle = vac["Vehicle"];
            const rentalRate = vac["RentalRate"];
            const totalCharge = vac["TotalCharge"];
            const reference = vac["Reference"];
            const rateQual = rentalRate["RateQualifier"];
            let vehicleCharges = rentalRate["VehicleCharges"]?.["VehicleCharge"];
            if (!Array.isArray(vehicleCharges))
                vehicleCharges = vehicleCharges ? [vehicleCharges] : [];
            const dailyCharge = vehicleCharges.find((c) => attr(c, "Purpose") === "1");
            const extraHoursCharge = vehicleCharges.find((c) => attr(c, "Purpose") === "11");
            let feeList = [];
            const fees = vac["Fees"];
            if (fees) {
                const fl = fees["Fee"];
                feeList = Array.isArray(fl) ? fl : fl ? [fl] : [];
            }
            const taxFee = feeList.find((f) => attr(f, "Purpose") === "6");
            const ivaFee = feeList.find((f) => attr(f, "Purpose") === "7");
            const returnFee = feeList.find((f) => attr(f, "Purpose") === "38");
            const availInfo = va["VehAvailInfo"];
            let coverages = [];
            if (availInfo?.["PricedCoverages"]) {
                const cl = availInfo["PricedCoverages"]["PricedCoverage"];
                coverages = Array.isArray(cl) ? cl : cl ? [cl] : [];
            }
            const basicCoverage = coverages.find((c) => {
                const cov = c["Coverage"];
                return attr(cov, "CoverageType") === "7";
            });
            const coverageCharge = basicCoverage ? basicCoverage["Charge"] : null;
            let discounts = [];
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
                IVAFeeAmount: parseFloat(attr(ivaFee, "Amount") || "0"),
                returnFeeAmount: parseFloat(attr(returnFee, "Amount") || "0"),
                discountAmount: discounts[0] ? parseFloat(attr(discounts[0], "Amount") || "0") : 0,
                discountPercentage: discounts[0] ? parseFloat(attr(discounts[0], "Percent") || "0") : 0,
                rateQualifier: attr(rateQual, "RateQualifier"),
                referenceToken: attr(reference, "ID"),
            };
        });
    }
    catch (error) {
        console.error("Error parsing availability response:", error);
        return [];
    }
}
router.post("/", async (req, res) => {
    const { pickupLocation, returnLocation, pickupDateTime, returnDateTime } = req.body;
    if (!pickupLocation || !returnLocation || !pickupDateTime || !returnDateTime) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }
    try {
        const config = (0, client_1.getConfig)();
        const xml = (0, xml_templates_1.buildVehAvailRateXML)({
            token: config.token,
            requestorId: config.requestorId,
            pickupLocation,
            returnLocation,
            pickupDateTime,
            returnDateTime,
        });
        const parsed = await (0, client_1.callLocalizaAPI)("http://www.opentravel.org/OTA/2003/05:OTA_VehAvailRateRQ", xml);
        const vehicles = extractAvailability(parsed);
        res.json(vehicles);
    }
    catch (error) {
        console.error("Availability error:", error);
        res.status(502).json({
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.default = router;
