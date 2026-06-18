import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveLocationByCode,
  findOrCreateCustomer,
  resolveReferral,
} from "@/lib/api/resolve-references";
import { normalizeIdentificationType } from "@/lib/api/normalize-identification-type";
import { snapshotFromCustomer } from "@/lib/queries/customers";
import { sendReservationNotifications } from "@/lib/email/notifications";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";
import { syncReservationToGhl } from "@/lib/ghl/sync";
import { parseMonthlyMileage } from "@/lib/reservation/mileage-parser";
import {
  createLocalizaReservation,
  ProxyTimeoutError,
  ProxyConfigError,
  ProxyError,
} from "@/lib/reservation/proxy-client";
import {
  deriveAttributionChannel,
  type AttributionInput,
} from "@/lib/attribution/derive-channel";
import { ServiceError } from "@/lib/api/service-error";
import type { ReservationStatus } from "@/lib/schemas/reservation";

/**
 * Explicit input for the reservation-creation core (issue #72 Step 3),
 * extracted behavior-preserving from `app/api/reservations/route.ts`. The public
 * route builds this from the request body; an in-process MCP server builds it
 * from a decoded quote + customer args. `createReservation` THROWS `ServiceError`
 * at every point the route used to `return NextResponse.json(payload, {status})`
 * so the public endpoint contract (both funnels) stays byte-identical — including
 * the structured Localiza proxy-error passthrough.
 */
export interface CreateReservationInput {
  // — quotation (from the quote / body) —
  pickup_location: string;
  return_location: string;
  pickup_date: string;
  pickup_hour: string;
  return_date: string;
  return_hour: string;
  selected_days: number;
  category: string;
  reference_token?: string; // required when selected_days < 30
  rate_qualifier?: string; // required when selected_days < 30
  total_price: number;
  total_price_to_pay: number;
  tax_fee?: number;
  iva_fee?: number;
  coverage_days?: number;
  coverage_price?: number;
  return_fee?: number;
  extra_hours?: number;
  extra_hours_price?: number;
  // — customer —
  fullname: string;
  identification_type: string;
  identification: string;
  email: string;
  phone: string;
  // — context —
  franchise: string;
  user?: string;
  attribution?: AttributionInput;
  idempotency_key?: string; // issue #99: forwarded to the proxy to dedupe resubmits
  // — extras (affect booking_type / notification_required) —
  total_insurance?: boolean | number;
  extra_driver?: boolean | number;
  baby_seat?: boolean | number;
  wash?: boolean | number;
  monthly_mileage?: string;
  flight?: boolean | number;
  aeroline?: string;
  flight_number?: string;
}

export interface CreateReservationResult {
  reserveCode: string;
  reservationStatus: ReservationStatus;
}

const LOCALIZA_STATUS_MAP: Record<string, ReservationStatus> = {
  Confirmed: "reservado",
  Reserved: "reservado",
  Pending: "pendiente",
};

// Coerce a raw attribution field to a clean string-or-null before it reaches a
// `text` column. A malformed caller can send a non-string (object/array/number);
// passing that straight through can 500 the INSERT and BLOCK THE BOOKING. This
// mirrors `deriveAttributionChannel`, which already treats non-strings as absent.
function attrStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function toBoolean(value: boolean | number | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return false;
}

function splitFullname(fullname: string): {
  first_name: string;
  last_name: string;
} {
  const parts = fullname.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { first_name: parts[0] || "", last_name: "" };
  }
  const first_name = parts[0];
  const last_name = parts.slice(1).join(" ");
  return { first_name, last_name };
}

export async function createReservation(
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  try {
    // 1. Resolve pickup location
    const pickupLocation = await resolveLocationByCode(input.pickup_location);
    if (!pickupLocation) {
      throw new ServiceError(400, {
        error: `Sucursal de recogida no encontrada: ${input.pickup_location}`,
      });
    }

    // 2. Resolve return location
    const returnLocation = await resolveLocationByCode(input.return_location);
    if (!returnLocation) {
      throw new ServiceError(400, {
        error: `Sucursal de devolución no encontrada: ${input.return_location}`,
      });
    }

    // 3. Find or create customer
    const { first_name, last_name } = splitFullname(input.fullname);
    const customerId = await findOrCreateCustomer({
      first_name,
      last_name,
      identification_type: normalizeIdentificationType(input.identification_type),
      identification_number: input.identification,
      phone: input.phone,
      email: input.email,
    });

    // 3b. Derive marketing attribution channel (issue #113). Returns null when
    // `attribution` is absent ("Desconocido"); the raw signals are persisted
    // verbatim for audit. The derivation is total — never throws — so a
    // malformed attribution object can never block a booking.
    const attribution = input.attribution;
    const attributionChannel = deriveAttributionChannel(attribution);

    // 4. Resolve referral
    let referralId: string | null = null;
    let referralRaw: string | null = null;

    if (input.user) {
      referralId = await resolveReferral(input.user);
      if (!referralId) {
        referralRaw = input.user;
      }
    }

    // 5. Determine reservation flow
    const isMonthly = input.selected_days >= 30;
    let reserveCode: string | null = null;
    let status: ReservationStatus;

    if (isMonthly) {
      // Monthly reservation: no API call
      status = "mensualidad";
    } else {
      // Standard reservation: call the Localiza proxy through the timeout +
      // idempotency client (issue #99). Its typed errors are mapped onto
      // ServiceError so the public route contract (both funnels) AND the MCP tool
      // stay byte-identical, including the retry-safe 504 and the structured
      // passthrough.
      if (!input.reference_token || !input.rate_qualifier) {
        throw new ServiceError(400, {
          error:
            "reference_token y rate_qualifier son requeridos para reservas estándar",
        });
      }

      const pickupDateTime = `${input.pickup_date}T${input.pickup_hour}:00`;
      const returnDateTime = `${input.return_date}T${input.return_hour}:00`;

      try {
        const proxyResult = await createLocalizaReservation(
          {
            pickupLocation: input.pickup_location,
            returnLocation: input.return_location,
            pickupDateTime,
            returnDateTime,
            categoryCode: input.category,
            referenceToken: input.reference_token,
            rateQualifier: input.rate_qualifier,
            customerName: input.fullname,
            customerEmail: input.email,
            customerPhone: input.phone,
            customerDocument: input.identification,
          },
          { idempotencyKey: input.idempotency_key },
        );

        reserveCode = proxyResult.reserveCode;
        status = LOCALIZA_STATUS_MAP[proxyResult.reservationStatus] ?? "pendiente";
      } catch (error) {
        if (error instanceof ProxyConfigError) {
          console.error("[reservation] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
          throw new ServiceError(500, {
            error: "Configuración del servidor incompleta",
          });
        }
        // A timeout — ours (the proxy never answered → ProxyTimeoutError) or the
        // proxy's own (Localiza slow → it returned 504 {upstream_timeout},
        // surfacing as a ProxyError) — converges on ONE retry-safe message. The
        // dashboard never inserts on this path, so there is no phantom on our
        // side; the booking MAY have completed on Localiza (504 is ambiguous) —
        // reconciliation is tracked separately (issue #99 SCEN-2).
        const isUpstreamTimeout =
          error instanceof ProxyTimeoutError ||
          (error instanceof ProxyError &&
            error.status === 504 &&
            (error.body as { error?: unknown } | null)?.error ===
              "upstream_timeout");
        if (isUpstreamTimeout) {
          console.error(
            "[reservation] Upstream timeout:",
            error instanceof Error ? error.message : String(error),
          );
          throw new ServiceError(504, {
            error: "upstream_timeout",
            message:
              "El sistema de reservas está demorando más de lo normal. Tu reserva NO se creó; espera unos minutos e inténtalo de nuevo.",
          });
        }
        if (error instanceof ProxyError) {
          console.error(`[reservation] Proxy error ${error.status}:`, error.rawText);
          // Pass the proxy's structured {error, message, shortText} through
          // unchanged so the funnels render the matching toast; wrap into a
          // generic 502 when the body is not parseable JSON (network/HTML error).
          if (
            error.body &&
            typeof error.body === "object" &&
            typeof (error.body as { error?: unknown }).error === "string"
          ) {
            throw new ServiceError(
              error.status,
              error.body as Record<string, unknown>,
            );
          }
          throw new ServiceError(502, {
            error: "Error al crear la reserva en Localiza",
          });
        }
        throw error; // unexpected — bubble to the outer catch → 500
      }
    }

    // 6. Determine booking_type
    const hasTotalInsurance = toBoolean(input.total_insurance);
    let bookingType: "standard" | "standard_with_insurance" | "monthly";
    if (isMonthly) {
      bookingType = "monthly";
    } else if (hasTotalInsurance) {
      bookingType = "standard_with_insurance";
    } else {
      bookingType = "standard";
    }

    // 7. Determine notification_required
    const hasExtras =
      toBoolean(input.extra_driver) ||
      toBoolean(input.baby_seat) ||
      toBoolean(input.wash);
    const notificationRequired = hasTotalInsurance || hasExtras || isMonthly;

    // 8. Save reservation to DB
    const supabase = createAdminClient();

    // Freeze the booker's identity from the STORED customer row the FK points
    // to (issue #26). Sourced from customer_id, never the raw body, so a #25
    // lenient CC-collision snapshots the resolved customer faithfully.
    const customerSnapshot = await snapshotFromCustomer(supabase, customerId);

    const { data: inserted, error: insertError } = await supabase
      .from("reservations")
      .insert({
        customer_id: customerId,
        ...customerSnapshot,
        rental_company_id: pickupLocation.rental_company_id,
        referral_id: referralId,
        referral_raw: referralRaw,
        pickup_location_id: pickupLocation.id,
        return_location_id: returnLocation.id,
        franchise: input.franchise,
        booking_type: bookingType,
        reservation_code: reserveCode,
        reference_token: input.reference_token ?? null,
        rate_qualifier: input.rate_qualifier ?? null,
        category_code: input.category,
        pickup_date: input.pickup_date,
        pickup_hour: input.pickup_hour,
        return_date: input.return_date,
        return_hour: input.return_hour,
        selected_days: input.selected_days,
        total_price: input.total_price,
        total_price_to_pay: input.total_price_to_pay,
        total_price_localiza: 0,
        tax_fee: input.tax_fee ?? 0,
        iva_fee: input.iva_fee ?? 0,
        coverage_days: input.coverage_days ?? 0,
        coverage_price: input.coverage_price ?? 0,
        return_fee: input.return_fee ?? 0,
        extra_hours: input.extra_hours ?? 0,
        extra_hours_price: input.extra_hours_price ?? 0,
        total_insurance: toBoolean(input.total_insurance),
        extra_driver: toBoolean(input.extra_driver),
        baby_seat: toBoolean(input.baby_seat),
        wash: toBoolean(input.wash),
        aeroline: input.aeroline ?? null,
        flight_number: input.flight_number ?? null,
        monthly_mileage: parseMonthlyMileage(input.monthly_mileage),
        notification_required: notificationRequired,
        status,
        // Marketing attribution (issue #113): 8 raw signals (referrer →
        // landing_referrer) + the derived channel. All null when absent.
        utm_source: attrStr(attribution?.utm_source),
        utm_medium: attrStr(attribution?.utm_medium),
        gclid: attrStr(attribution?.gclid),
        gad_source: attrStr(attribution?.gad_source),
        fbclid: attrStr(attribution?.fbclid),
        ttclid: attrStr(attribution?.ttclid),
        msclkid: attrStr(attribution?.msclkid),
        landing_referrer: attrStr(attribution?.referrer),
        attribution_channel: attributionChannel,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // Issue #138 — DB-backed idempotency. A 23505 on the partial unique index
      // `reservations_reservation_code_unique` means a concurrent resubmit or a
      // 2nd Fluid Compute instance already inserted THIS booking: #99 makes the
      // proxy replay the same reserveCode, so both racing inserts carry it and
      // Postgres arbitrates — the loser lands here. Return the same result as the
      // winner WITHOUT re-inserting or re-notifying (idempotent, cross-instance).
      // `reserveCode` is guaranteed non-empty on this path: the index predicate
      // excludes NULL and '' (monthly/empty never reach here). Any OTHER error —
      // including a 23505 on a different constraint — is a real failure → 500.
      if (
        insertError?.code === "23505" &&
        insertError.message?.includes("reservations_reservation_code_unique") &&
        reserveCode
      ) {
        // Return the WINNER's persisted status, not the status recomputed from
        // this request's proxy reply. If the resubmit lands after #99's proxy
        // replay TTL, Localiza may re-issue the same ConfID with an advanced
        // status — returning the local `status` would hand this caller a value
        // that disagrees with both the stored row and the notifications the
        // customer already received. A 23505 means the winner committed (READ
        // COMMITTED), so this read-back sees it; the `?? status` fallback only
        // covers the unreachable null case. Scoped to the indexed partition so a
        // legacy row sharing the code can never be picked.
        const { data: winner } = await supabase
          .from("reservations")
          .select("status")
          .eq("reservation_code", reserveCode)
          .gte("created_at", "2026-01-01")
          .limit(1)
          .single();
        console.log(
          `[reservation] Idempotent replay: reservation_code ${reserveCode} already exists — skipping insert + notifications`,
        );
        return {
          reserveCode,
          reservationStatus: (winner?.status as ReservationStatus) ?? status,
        };
      }
      console.error("[reservation] Insert failed:", insertError?.message);
      throw new ServiceError(500, { error: "Error al guardar la reserva" });
    }

    // 9. Dispatch notifications. Email is sent inline (was inside after() but
    // the after() callback appears to run in a bundle context that pinned a
    // pre-a02f8b9 chunk of the reservation template — moving it inline is a
    // diagnostic step to confirm/refute that hypothesis. WhatsApp + GHL stay
    // in after() to keep the client-facing response fast.
    const reservationId = inserted.id;

    console.log(
      `[reservation] Sending email notifications inline for ${reservationId}`,
    );
    try {
      await sendReservationNotifications(reservationId, status, input.franchise);
    } catch (err) {
      console.error("[reservation] Status notifications failed:", err);
    }

    after(async () => {
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
      console.log(
        `[reservation] Background dispatch completed for ${reservationId}`,
      );
    });

    // 10. Return result
    return {
      reserveCode: reserveCode ?? inserted.id,
      reservationStatus: status,
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    console.error("[reservation] Unexpected error:", error);
    throw new ServiceError(500, { error: "Error interno del servidor" });
  }
}
