"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("./client");
const xml_templates_1 = require("./xml-templates");
const router = (0, express_1.Router)();
function extractReservation(parsed) {
    const envelope = parsed["Envelope"];
    const body = envelope["Body"];
    const rs = body["OTA_VehResRS"];
    const core = rs["VehResRSCore"];
    const status = (core["$"] || {})["ReservationStatus"] || "";
    const reservation = core["VehReservation"];
    const segCore = reservation["VehSegmentCore"];
    const confId = segCore["ConfID"];
    const reserveCode = (confId["$"] || {})["ID"] || "";
    return { reserveCode, reservationStatus: status };
}
router.post("/", async (req, res) => {
    const data = req.body;
    if (!data.pickupLocation || !data.returnLocation ||
        !data.pickupDateTime || !data.returnDateTime ||
        !data.categoryCode || !data.referenceToken ||
        !data.rateQualifier || !data.customerName ||
        !data.customerEmail || !data.customerPhone ||
        !data.customerDocument) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }
    try {
        const config = (0, client_1.getConfig)();
        const xml = (0, xml_templates_1.buildVehResXML)({
            token: config.token,
            requestorId: config.requestorId,
            pickupLocation: data.pickupLocation,
            returnLocation: data.returnLocation,
            pickupDateTime: data.pickupDateTime,
            returnDateTime: data.returnDateTime,
            categoryCode: data.categoryCode,
            referenceToken: data.referenceToken,
            rateQualifier: data.rateQualifier,
            customerName: data.customerName,
            customerEmail: data.customerEmail,
            customerPhone: data.customerPhone,
            customerPhoneCountryCode: data.customerPhoneCountryCode || "57",
            customerDocument: data.customerDocument,
            customerDocumentType: data.customerDocumentType || "5",
        });
        const parsed = await (0, client_1.callLocalizaAPI)("http://www.opentravel.org/OTA/2003/05:OTA_VehResRQ", xml);
        const result = extractReservation(parsed);
        res.json(result);
    }
    catch (error) {
        console.error("Reservation error:", error);
        res.status(502).json({
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
exports.default = router;
