import { NextResponse } from "next/server";
import { searchAvailability } from "@/lib/api/availability-service";
import { serviceErrorToResponse } from "@/lib/api/service-error";

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

  try {
    const result = await searchAvailability({
      pickupLocation,
      returnLocation,
      pickupDateTime,
      returnDateTime,
    });
    return NextResponse.json(result);
  } catch (e) {
    return serviceErrorToResponse(e);
  }
}
