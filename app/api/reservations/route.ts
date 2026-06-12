import { NextResponse } from "next/server";
import {
  createReservation,
  type CreateReservationInput,
} from "@/lib/api/reservation-service";
import { serviceErrorToResponse } from "@/lib/api/service-error";

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

  try {
    return NextResponse.json(await createReservation(body));
  } catch (e) {
    return serviceErrorToResponse(e);
  }
}
