import { NextResponse, after } from "next/server";
import { searchAvailability } from "@/lib/api/availability-service";
import { serviceErrorToResponse } from "@/lib/api/service-error";
import {
  searchLogContextSchema,
  logAvailabilitySearch,
} from "@/lib/api/search-log";

// Public read endpoint (no API key): quoting has no side effects, so any AI
// agent can fetch prices. Abuse is bounded by the Vercel WAF rate limit, not a
// shared secret. The write counterpart (POST /api/reservations) stays gated by
// RESERVATION_API_KEY.
export async function POST(request: Request) {
  // Preserve the original ordering: the proxy-config guard runs before body
  // parsing, so a misconfigured server 500s regardless of the body shape.
  if (!process.env.LOCALIZA_PROXY_URL || !process.env.PROXY_API_KEY) {
    console.error("[availability] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
    return NextResponse.json(
      { error: "Configuración del servidor incompleta" },
      { status: 500 }
    );
  }

  let body: {
    pickupLocation: string;
    returnLocation: string;
    pickupDateTime: string;
    returnDateTime: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de solicitud inválido" },
      { status: 400 }
    );
  }

  const { pickupLocation, returnLocation, pickupDateTime, returnDateTime } = body;

  if (!pickupLocation || !returnLocation || !pickupDateTime || !returnDateTime) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: pickupLocation, returnLocation, pickupDateTime, returnDateTime" },
      { status: 400 }
    );
  }

  // Optional logging context (issue #206) — backward-compatible: the funnels'
  // current 4-field payloads parse to an empty context, so nothing changes for
  // them. franchise/referralCode/sessionId/isMonthly arrive once the funnels are
  // updated (follow-up). Malformed context never blocks quoting: on a parse miss
  // we just log without it.
  const ctx = searchLogContextSchema.safeParse(body);
  const logContext = ctx.success ? ctx.data : {};

  try {
    const result = await searchAvailability({
      pickupLocation,
      returnLocation,
      pickupDateTime,
      returnDateTime,
    });

    // Fire-and-forget: log successful array responses (incl. 0 results) AFTER the
    // response is sent. `logAvailabilitySearch` never throws; quoting is untouched.
    if (Array.isArray(result)) {
      const forwardedFor = request.headers.get("x-forwarded-for");
      after(() =>
        logAvailabilitySearch({
          ...logContext,
          pickupLocation,
          returnLocation,
          pickupDateTime,
          returnDateTime,
          availableCategories: result,
          userAgent: request.headers.get("user-agent"),
          // `||` (not `??`): an empty/whitespace x-forwarded-for must fall through
          // to x-real-ip and finally null, never persist "" as the ip_address.
          ipAddress:
            forwardedFor?.split(",")[0]?.trim() ||
            request.headers.get("x-real-ip") ||
            null,
        })
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    return serviceErrorToResponse(e);
  }
}
