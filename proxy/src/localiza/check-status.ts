import { Router, Request, Response } from "express";
import { callLocalizaAPI, getConfig } from "./client";
import { buildVehRetResXML } from "./xml-templates";

const router = Router();

function extractReservationStatus(parsed: Record<string, unknown>): {
  reservationStatus: string;
  reserveCode: string;
} {
  const envelope = parsed["Envelope"] as Record<string, unknown>;
  const body = envelope["Body"] as Record<string, unknown>;
  const wrapper = (body["OTA_VehRetResResponse"] || body) as Record<string, unknown>;
  const rs = (wrapper["OTA_VehRetResRS"] || body["OTA_VehRetResRS"]) as Record<string, unknown>;

  if (rs["Errors"]) {
    const errors = rs["Errors"] as Record<string, unknown>;
    const error = errors["Error"] as Record<string, unknown>;
    const message = error?.["_"] || JSON.stringify(error);
    throw new Error(`Localiza error: ${message}`);
  }

  const core = rs["VehRetResRSCore"] as Record<string, unknown>;
  const reservation = core["VehReservation"] as Record<string, unknown>;

  const attr = (obj: unknown, field: string): string => {
    if (!obj || typeof obj !== "object") return "";
    return (((obj as Record<string, unknown>)["$"] as Record<string, string>) || {})[field] || "";
  };

  const status = attr(reservation, "ReservationStatus");
  const segCore = reservation["VehSegmentCore"] as Record<string, unknown>;
  const confId = segCore["ConfID"] as Record<string, unknown>;
  const reserveCode = attr(confId, "ID");

  return { reservationStatus: status, reserveCode };
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const { reservationCode } = req.body as { reservationCode: string };

  if (!reservationCode) {
    res.status(400).json({ error: "Missing reservationCode" });
    return;
  }

  try {
    const config = getConfig();
    const xml = buildVehRetResXML(config.token, reservationCode);

    const parsed = await callLocalizaAPI(
      "http://www.opentravel.org/OTA/2003/05:OTA_VehRetResRQ",
      xml,
    );

    const result = extractReservationStatus(parsed);
    res.json(result);
  } catch (error) {
    console.error("Check status error:", error);
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
