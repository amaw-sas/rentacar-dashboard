import { Router, Request, Response } from "express";
import { callLocalizaAPI, getConfig } from "./client";
import { buildVehResXML } from "./xml-templates";
import {
  LocalizaWarningError,
  buildLocalizaWarning,
  extractErrorMessage,
  extractWarningShortText,
  logLocalizaUpstream,
} from "./warnings";

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

function attr(obj: unknown, field: string): string {
  if (!obj || typeof obj !== "object") return "";
  return (((obj as Record<string, unknown>)["$"] as Record<string, string>) || {})[field] || "";
}

function findConfId(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;

  // Check direct ConfID (object or array)
  if (obj["ConfID"]) {
    const list = Array.isArray(obj["ConfID"]) ? obj["ConfID"] : [obj["ConfID"]];
    // Prefer ConfID with Type="14" (reservation code)
    for (const item of list) {
      if (attr(item, "Type") === "14") {
        const id = attr(item, "ID");
        if (id) return id;
      }
    }
    // Fallback: first with any ID
    for (const item of list) {
      const id = attr(item, "ID");
      if (id) return id;
    }
  }

  // Recurse into children
  for (const key of Object.keys(obj)) {
    if (key === "$" || key === "_") continue;
    const child = obj[key];
    if (typeof child === "object" && child !== null) {
      const result = findConfId(child);
      if (result) return result;
    }
  }

  return "";
}

function findReservationStatus(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;

  // Look for ReservationStatus attribute on VehReservation
  if (obj["VehReservation"]) {
    const vehRes = obj["VehReservation"];
    const status = attr(vehRes, "ReservationStatus");
    if (status) return status;
    // Recurse into VehReservation
    return findReservationStatus(vehRes);
  }

  // Check current node attributes
  const status = attr(obj, "ReservationStatus");
  if (status) return status;

  // Recurse
  for (const key of Object.keys(obj)) {
    if (key === "$" || key === "_") continue;
    const child = obj[key];
    if (typeof child === "object" && child !== null) {
      const result = findReservationStatus(child);
      if (result) return result;
    }
  }

  return "";
}

function extractReservation(
  parsed: Record<string, unknown>,
  requestContext?: Record<string, unknown>,
) {
  const envelope = parsed["Envelope"] as Record<string, unknown>;
  const body = envelope["Body"] as Record<string, unknown>;
  // Localiza wraps response in OTA_VehResResponse
  const wrapper = (body["OTA_VehResResponse"] || body) as Record<string, unknown>;
  const rs = (wrapper["OTA_VehResRS"] || body["OTA_VehResRS"]) as Record<string, unknown>;

  if (rs["Errors"]) {
    const upstream = extractErrorMessage(rs["Errors"]);
    console.error("Localiza reservation API error:", upstream);
    logLocalizaUpstream({
      event: "localiza_upstream_errors",
      endpoint: "reservation",
      payload: rs["Errors"],
      request: requestContext,
    });
    throw buildLocalizaWarning(null);
  }

  if (rs["Warnings"]) {
    const shortText = extractWarningShortText(rs["Warnings"]);
    logLocalizaUpstream({
      event: "localiza_upstream_warnings",
      endpoint: "reservation",
      payload: rs["Warnings"],
      shortText,
      request: requestContext,
    });
    throw buildLocalizaWarning(shortText);
  }

  // ReservationStatus is on VehReservation, not VehResRSCore
  const reservationStatus = findReservationStatus(rs);
  // ConfID with Type="14" is the reservation code — search recursively
  const reserveCode = findConfId(rs);

  if (!reserveCode) {
    console.warn("[extractReservation] reserveCode not found in:", JSON.stringify(rs).slice(0, 2000));
  }

  return { reserveCode, reservationStatus };
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

    const result = extractReservation(parsed, {
      pickupLocation: data.pickupLocation,
      returnLocation: data.returnLocation,
      pickupDateTime: data.pickupDateTime,
      returnDateTime: data.returnDateTime,
      categoryCode: data.categoryCode,
      referenceToken: data.referenceToken,
      rateQualifier: data.rateQualifier,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof LocalizaWarningError) {
      res.status(error.httpStatus).json(error.toJSON());
      return;
    }
    console.error("Reservation error:", error);
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
