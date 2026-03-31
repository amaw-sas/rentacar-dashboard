import { Router, Request, Response } from "express";
import { callLocalizaAPI, getConfig } from "./client";
import { buildVehResXML } from "./xml-templates";

const router = Router();

interface ReservationRequest {
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
  categoryCode: string;
  referenceToken: string;
  rateQualifier: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerPhoneCountryCode?: string;
  customerDocument: string;
  customerDocumentType?: string;
}

function extractReservation(parsed: Record<string, unknown>) {
  const envelope = parsed["Envelope"] as Record<string, unknown>;
  const body = envelope["Body"] as Record<string, unknown>;
  const rs = body["OTA_VehResRS"] as Record<string, unknown>;
  const core = rs["VehResRSCore"] as Record<string, unknown>;

  const status = ((core["$"] as Record<string, string>) || {})["ReservationStatus"] || "";
  const reservation = core["VehReservation"] as Record<string, unknown>;
  const segCore = reservation["VehSegmentCore"] as Record<string, unknown>;
  const confId = segCore["ConfID"] as Record<string, unknown>;
  const reserveCode = ((confId["$"] as Record<string, string>) || {})["ID"] || "";

  return { reserveCode, reservationStatus: status };
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const data = req.body as ReservationRequest;

  if (
    !data.pickupLocation || !data.returnLocation ||
    !data.pickupDateTime || !data.returnDateTime ||
    !data.categoryCode || !data.referenceToken ||
    !data.rateQualifier || !data.customerName ||
    !data.customerEmail || !data.customerPhone ||
    !data.customerDocument
  ) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    const config = getConfig();
    const xml = buildVehResXML({
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

    const parsed = await callLocalizaAPI(
      "http://www.opentravel.org/OTA/2003/05:OTA_VehResRQ",
      xml,
    );

    const result = extractReservation(parsed);
    res.json(result);
  } catch (error) {
    console.error("Reservation error:", error);
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
