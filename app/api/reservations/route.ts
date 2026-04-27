// build-marker:2026-04-27-template-bundle — forces lambda regeneration so
// sendReservationNotifications picks up the post-a02f8b9 reserved-confirmation bundle.
// Safe to remove once a fresh "reservado_cliente" notification is verified.
import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveLocationByCode,
  findOrCreateCustomer,
  resolveReferral,
} from "@/lib/api/resolve-references";
import { normalizeIdentificationType } from "@/lib/api/normalize-identification-type";
import { sendReservationNotifications } from "@/lib/email/notifications";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";
import { syncReservationToGhl } from "@/lib/ghl/sync";
import { parseMonthlyMileage } from "@/lib/reservation/mileage-parser";
import type { ReservationStatus } from "@/lib/schemas/reservation";

interface ReservationRequestBody {
  fullname: string;
  identification_type: string;
  identification: string;
  phone: string;
  email: string;
  category: string;
  pickup_location: string;
  return_location: string;
  pickup_date: string;
  pickup_hour: string;
  return_date: string;
  return_hour: string;
  selected_days: number;
  extra_hours: number;
  extra_hours_price: number;
  coverage_days: number;
  coverage_price: number;
  return_fee: number;
  tax_fee: number;
  iva_fee: number;
  total_price: number;
  total_price_to_pay: number;
  franchise: string;
  user?: string;
  monthly_mileage?: string;
  total_insurance?: boolean | number;
  reference_token?: string;
  rate_qualifier?: string;
  extra_driver?: boolean | number;
  baby_seat?: boolean | number;
  wash?: boolean | number;
  flight?: boolean | number;
  aeroline?: string;
  flight_number?: string;
}

const LOCALIZA_STATUS_MAP: Record<string, ReservationStatus> = {
  Confirmed: "reservado",
  Reserved: "reservado",
  Pending: "pendiente",
};

function toBoolean(value: boolean | number | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return false;
}

function splitFullname(fullname: string): { first_name: string; last_name: string } {
  const parts = fullname.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { first_name: parts[0] || "", last_name: "" };
  }
  const first_name = parts[0];
  const last_name = parts.slice(1).join(" ");
  return { first_name, last_name };
}

export async function POST(request: Request) {
  // Validate API key
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.RESERVATION_API_KEY) {
    return NextResponse.json(
      { error: "No autorizado" },
      { status: 401 }
    );
  }

  let body: ReservationRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de solicitud inválido" },
      { status: 400 }
    );
  }

  // Validate required fields
  const requiredFields: (keyof ReservationRequestBody)[] = [
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
    // 1. Resolve pickup location
    const pickupLocation = await resolveLocationByCode(body.pickup_location);
    if (!pickupLocation) {
      return NextResponse.json(
        { error: `Sucursal de recogida no encontrada: ${body.pickup_location}` },
        { status: 400 }
      );
    }

    // 2. Resolve return location
    const returnLocation = await resolveLocationByCode(body.return_location);
    if (!returnLocation) {
      return NextResponse.json(
        { error: `Sucursal de devolución no encontrada: ${body.return_location}` },
        { status: 400 }
      );
    }

    // 3. Find or create customer
    const { first_name, last_name } = splitFullname(body.fullname);
    const customerId = await findOrCreateCustomer({
      first_name,
      last_name,
      identification_type: normalizeIdentificationType(body.identification_type),
      identification_number: body.identification,
      phone: body.phone,
      email: body.email,
    });

    // 4. Resolve referral
    let referralId: string | null = null;
    let referralRaw: string | null = null;

    if (body.user) {
      referralId = await resolveReferral(body.user);
      if (!referralId) {
        referralRaw = body.user;
      }
    }

    // 5. Determine reservation flow
    const isMonthly = body.selected_days >= 30;
    let reserveCode: string | null = null;
    let status: ReservationStatus;

    if (isMonthly) {
      // Monthly reservation: no API call
      status = "mensualidad";
    } else {
      // Standard reservation: call Localiza proxy
      if (!body.reference_token || !body.rate_qualifier) {
        return NextResponse.json(
          { error: "reference_token y rate_qualifier son requeridos para reservas estándar" },
          { status: 400 }
        );
      }

      const proxyUrl = process.env.LOCALIZA_PROXY_URL;
      const proxyApiKey = process.env.PROXY_API_KEY;

      if (!proxyUrl || !proxyApiKey) {
        console.error("[reservation] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
        return NextResponse.json(
          { error: "Configuración del servidor incompleta" },
          { status: 500 }
        );
      }

      const pickupDateTime = `${body.pickup_date}T${body.pickup_hour}:00`;
      const returnDateTime = `${body.return_date}T${body.return_hour}:00`;

      const proxyResponse = await fetch(`${proxyUrl}/api/localiza/reservation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": proxyApiKey,
        },
        body: JSON.stringify({
          pickupLocation: body.pickup_location,
          returnLocation: body.return_location,
          pickupDateTime,
          returnDateTime,
          categoryCode: body.category,
          referenceToken: body.reference_token,
          rateQualifier: body.rate_qualifier,
          customerName: body.fullname,
          customerEmail: body.email,
          customerPhone: body.phone,
          customerDocument: body.identification,
        }),
      });

      if (!proxyResponse.ok) {
        const errorBody = await proxyResponse.text();
        console.error(`[reservation] Proxy error ${proxyResponse.status}:`, errorBody);
        // Pass structured {error, message, shortText} from the proxy through
        // unchanged so the Nuxt client (useMessages.createErrorMessage) can
        // render the matching toast. Only wrap into a generic envelope when
        // the body is not parseable JSON (network/HTML error).
        try {
          const parsed = JSON.parse(errorBody);
          if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
            return NextResponse.json(parsed, { status: proxyResponse.status });
          }
        } catch {
          // fall through to the generic response below
        }
        return NextResponse.json(
          { error: "Error al crear la reserva en Localiza" },
          { status: 502 }
        );
      }

      const proxyResult = await proxyResponse.json() as {
        reserveCode: string;
        reservationStatus: string;
      };

      reserveCode = proxyResult.reserveCode;
      status = LOCALIZA_STATUS_MAP[proxyResult.reservationStatus] ?? "pendiente";
    }

    // 6. Determine booking_type
    const hasTotalInsurance = toBoolean(body.total_insurance);
    let bookingType: "standard" | "standard_with_insurance" | "monthly";
    if (isMonthly) {
      bookingType = "monthly";
    } else if (hasTotalInsurance) {
      bookingType = "standard_with_insurance";
    } else {
      bookingType = "standard";
    }

    // 7. Determine notification_required
    const hasExtras = toBoolean(body.extra_driver) || toBoolean(body.baby_seat) || toBoolean(body.wash);
    const notificationRequired = hasTotalInsurance || hasExtras || isMonthly;

    // 8. Save reservation to DB
    const supabase = createAdminClient();

    const { data: inserted, error: insertError } = await supabase
      .from("reservations")
      .insert({
        customer_id: customerId,
        rental_company_id: pickupLocation.rental_company_id,
        referral_id: referralId,
        referral_raw: referralRaw,
        pickup_location_id: pickupLocation.id,
        return_location_id: returnLocation.id,
        franchise: body.franchise,
        booking_type: bookingType,
        reservation_code: reserveCode,
        reference_token: body.reference_token ?? null,
        rate_qualifier: body.rate_qualifier ?? null,
        category_code: body.category,
        pickup_date: body.pickup_date,
        pickup_hour: body.pickup_hour,
        return_date: body.return_date,
        return_hour: body.return_hour,
        selected_days: body.selected_days,
        total_price: body.total_price,
        total_price_to_pay: body.total_price_to_pay,
        total_price_localiza: 0,
        tax_fee: body.tax_fee ?? 0,
        iva_fee: body.iva_fee ?? 0,
        coverage_days: body.coverage_days ?? 0,
        coverage_price: body.coverage_price ?? 0,
        return_fee: body.return_fee ?? 0,
        extra_hours: body.extra_hours ?? 0,
        extra_hours_price: body.extra_hours_price ?? 0,
        total_insurance: toBoolean(body.total_insurance),
        extra_driver: toBoolean(body.extra_driver),
        baby_seat: toBoolean(body.baby_seat),
        wash: toBoolean(body.wash),
        aeroline: body.aeroline ?? null,
        flight_number: body.flight_number ?? null,
        monthly_mileage: parseMonthlyMileage(body.monthly_mileage),
        notification_required: notificationRequired,
        status,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("[reservation] Insert failed:", insertError?.message);
      return NextResponse.json(
        { error: "Error al guardar la reserva" },
        { status: 500 }
      );
    }

    // 9. Dispatch notifications after response is sent (non-blocking but guaranteed to run)
    const reservationId = inserted.id;

    after(async () => {
      console.log(`[reservation] Dispatching notifications for ${reservationId}`);
      try {
        await sendReservationNotifications(reservationId, status, body.franchise);
      } catch (err) {
        console.error("[reservation] Status notifications failed:", err);
      }
      try {
        await sendStatusWhatsApp(reservationId, status);
      } catch (err) {
        console.error("[reservation] WhatsApp notification failed:", err);
      }
      try {
        await syncReservationToGhl(reservationId);
      } catch (err) {
        console.error("[reservation] GHL sync failed:", err);
      }
      console.log(`[reservation] Notifications dispatch completed for ${reservationId}`);
    });

    // 10. Return response
    return NextResponse.json({
      reserveCode: reserveCode ?? inserted.id,
      reservationStatus: status,
    });
  } catch (error) {
    console.error("[reservation] Unexpected error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
