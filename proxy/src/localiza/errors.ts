import { Response } from "express";
import { LocalizaWarningError } from "./warnings";

// Thrown when a Localiza SOAP call exceeds its abort deadline (the AbortSignal
// fired). Distinct from LocalizaWarningError (a business warning) and from a
// generic upstream/infra failure, so mapLocalizaError can return 504 (gateway
// timeout) instead of the generic 502 — and the dashboard can reconcile/retry
// safely instead of treating the timeout as a hard failure.
export class LocalizaTimeoutError extends Error {
  constructor(message = "Localiza request timed out") {
    super(message);
    this.name = "LocalizaTimeoutError";
  }
}

// Retry-safe message surfaced when an upstream call times out. Intentionally
// endpoint-agnostic — this helper is shared by availability/reservation/
// check-status. The dashboard layers a booking-specific reassurance ("tu
// reserva NO se creó") for the reservation flow (issue #99, Step 5).
export const UPSTREAM_TIMEOUT_MESSAGE =
  "El servicio de reservas está demorando más de lo normal. Por favor inténtalo de nuevo en unos minutos.";

// Single point that maps a thrown Localiza error to an HTTP response, shared by
// the three proxy endpoints so timeouts map to 504 consistently while every
// other case preserves the pre-existing contract:
//   LocalizaWarningError -> error.httpStatus + toJSON()  (business warning)
//   LocalizaTimeoutError -> 504 { error: "upstream_timeout", message }
//   anything else        -> 502 { error: <message> }     (real upstream/infra failure)
export function mapLocalizaError(
  error: unknown,
  res: Response,
  endpoint = "Localiza",
): void {
  if (error instanceof LocalizaWarningError) {
    res.status(error.httpStatus).json(error.toJSON());
    return;
  }
  if (error instanceof LocalizaTimeoutError) {
    console.warn(`${endpoint} timeout:`, error.message);
    res
      .status(504)
      .json({ error: "upstream_timeout", message: UPSTREAM_TIMEOUT_MESSAGE });
    return;
  }
  console.error(`${endpoint} error:`, error);
  res.status(502).json({
    error: error instanceof Error ? error.message : "Unknown error",
  });
}
