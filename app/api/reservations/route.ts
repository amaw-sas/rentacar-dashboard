import { NextResponse } from "next/server";
import {
  createReservation,
  type CreateReservationInput,
} from "@/lib/api/reservation-service";
import { serviceErrorToResponse } from "@/lib/api/service-error";
import { getClientIp } from "@/lib/api/reservation-guards";

// Fail fast and cleanly instead of hanging into Vercel's hard 504 (issue #99).
// PROXY_TIMEOUT_MS (28s) sits below this so createLocalizaReservation aborts and
// returns a retry-safe error before the function is killed. MUST be a literal —
// Next.js segment config is statically analyzed and rejects an imported const —
// so it mirrors proxy-client's MAX_DURATION_S; a test guards against drift.
export const maxDuration = 30;

export async function POST(request: Request) {
  // Validate API key
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.RESERVATION_API_KEY) {
    return NextResponse.json(
      { error: "No autorizado" },
      { status: 401 }
    );
  }

  let body: CreateReservationInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de solicitud inválido" },
      { status: 400 }
    );
  }

  // Validate required fields
  const requiredFields: (keyof CreateReservationInput)[] = [
    "fullname", "identification_type", "identification", "phone", "email",
    "category", "pickup_location", "return_location", "pickup_date",
    "pickup_hour", "return_date", "return_hour", "selected_days",
    "total_price", "total_price_to_pay", "franchise",
  ];

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return NextResponse.json(
        { error: `Campo requerido faltante: ${field}` },
        { status: 400 }
      );
    }
  }

  // Forward the idempotency key (issue #99) so a reload+resubmit dedupes at the
  // proxy. createReservation threads it into createLocalizaReservation.
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (idempotencyKey) body.idempotency_key = idempotencyKey;

  // Supply the client IP so the service can rate-limit per IP (synthetic-wave
  // fix). The in-process MCP funnel omits it; per-doc limit + dedup still apply.
  body.client_ip = getClientIp(request);

  try {
    return NextResponse.json(await createReservation(body));
  } catch (e) {
    return serviceErrorToResponse(e);
  }
}
