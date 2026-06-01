import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendAttachment } from "./send";
import { renderEmail } from "./render";
import { fetchLogoAttachment } from "./fetch-logo";
import { LOGO_CONTENT_ID } from "./constants";
import { ReservedClientEmail } from "./templates/reserved-confirmation";
import { PendingClientEmail } from "./templates/pending-client";
import { FailedClientEmail } from "./templates/failed-client";
import { ReservationRequestEmail } from "./templates/reservation-request";
import { PendingLocalizaEmail } from "./templates/pending-localiza";
import { TotalInsuranceLocalizaEmail } from "./templates/total-insurance-localiza";
import { ExtrasLocalizaEmail } from "./templates/extras-localiza";
import { MonthlyLocalizaEmail } from "./templates/monthly-localiza";
import { MonthlyClientEmail } from "./templates/monthly-client";
import type { ReservationStatus } from "@/lib/schemas/reservation";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function isSafeMapUrl(u: string): boolean {
  return (
    u.startsWith("https://maps.app.goo.gl/") ||
    u.startsWith("https://www.google.com/maps/")
  );
}

function safeMapUrlOrWarn(
  url: string,
  locationCode: string | undefined
): string | undefined {
  if (!url) return undefined;
  if (isSafeMapUrl(url)) return url;
  console.warn(
    `[email] rejected unsafe map URL for location ${locationCode ?? "<unknown>"}: ${url}`
  );
  return undefined;
}

type LocationFallback = {
  pickup_address?: string;
  pickup_map?: string;
  return_address?: string | null;
  return_map?: string | null;
};

function resolveReturnPair(loc: LocationFallback): { address: string; mapRaw: string } {
  // Atomic both-or-neither: only honor the return_* override when BOTH are
  // non-empty after trim. Migration 025 has CHECK on pickup_* but not on
  // return_*; whitespace-only or mixed-null pairs fall back to pickup_*.
  const useOverride =
    Boolean(loc.return_address?.trim()) && Boolean(loc.return_map?.trim());
  return {
    address: useOverride ? (loc.return_address as string) : (loc.pickup_address ?? ""),
    mapRaw: useOverride ? (loc.return_map as string) : (loc.pickup_map ?? ""),
  };
}
import { FRANCHISE_BRANDING } from "@/lib/constants/franchises";

interface FranchiseBranding {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  franchiseWhatsapp?: string;
  franchiseLogo?: string;
}

async function fetchReservationContext(reservationId: string) {
  const supabase = createAdminClient();

  const { data: reservation, error } = await supabase
    .from("reservations")
    .select(
      `
      *,
      customers (first_name, last_name, email, phone),
      pickup_location:locations!pickup_location_id (
        name, code, pickup_address, pickup_map
      ),
      return_location:locations!return_location_id (
        name, code, pickup_address, pickup_map, return_address, return_map
      ),
      rental_companies (
        extra_driver_day_price,
        wash_price,
        wash_onsite_price,
        wash_deep_price,
        wash_deep_upholstery_price
      )
    `
    )
    .eq("id", reservationId)
    .single();

  if (error || !reservation) {
    throw new Error(`Failed to fetch reservation ${reservationId}: ${error?.message}`);
  }

  return reservation;
}

interface FranchiseContext {
  branding: FranchiseBranding;
  localizaBccEmail: string | null;
}

async function getFranchiseContext(
  franchiseCode: string
): Promise<FranchiseContext> {
  const supabase = createAdminClient();
  const { data: franchise } = await supabase
    .from("franchises")
    .select("display_name, phone, whatsapp, logo_url, website, localiza_bcc_email")
    .eq("code", franchiseCode)
    .single();

  const brandingDefaults = FRANCHISE_BRANDING[franchiseCode] ?? {
    color: "#18181b",
    website: "",
  };

  return {
    branding: {
      franchiseName: franchise?.display_name ?? franchiseCode,
      franchiseColor: brandingDefaults.color,
      franchiseWebsite: franchise?.website ?? brandingDefaults.website,
      franchisePhone: franchise?.phone ?? "",
      franchiseWhatsapp: franchise?.whatsapp || undefined,
      franchiseLogo: franchise?.logo_url || undefined,
    },
    localizaBccEmail: franchise?.localiza_bcc_email ?? null,
  };
}

function resolveLocalizaBcc(perFranchise: string | null): string | undefined {
  // Per-franchise column wins; env var is the transitional fallback. Empty
  // strings collapse to undefined so we never send `bcc: [""]`.
  const fallback = process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL;
  return perFranchise || fallback || undefined;
}

// Issue #9: embed the franchise logo as inline CID attachment so emails
// stop landing in Hotmail/Outlook spam. Fetches once per notification
// invocation; the same Buffer is propagated to every sendEmail() call
// that the invocation dispatches (1-4 emails), avoiding redundant fetches.
// On fetch failure, franchiseLogo becomes undefined and the layout
// renders the franchise name as text — graceful fallback.
// LOGO_CONTENT_ID is shared with the preview (lib/email/preview.ts) via
// ./constants so the cid: reference never drifts between send and preview.

async function prepareLogoForEmail(branding: FranchiseBranding): Promise<{
  branding: FranchiseBranding;
  attachments: SendAttachment[] | undefined;
}> {
  const logo = await fetchLogoAttachment(branding.franchiseLogo);
  if (!logo) {
    return {
      branding: { ...branding, franchiseLogo: undefined },
      attachments: undefined,
    };
  }
  return {
    branding: { ...branding, franchiseLogo: `cid:${LOGO_CONTENT_ID}` },
    attachments: [
      {
        filename: logo.filename,
        content: logo.content,
        contentId: LOGO_CONTENT_ID,
        contentType: logo.contentType,
      },
    ],
  };
}

function formatDate(dateStr: string): string {
  return format(new Date(dateStr + "T12:00:00"), "d 'de' MMMM yyyy", { locale: es });
}

function formatHour(hourStr: string): string {
  const parts = hourStr.split(":");
  const h = parseInt(parts[0]);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return h12 + ":" + m + " " + ampm;
}

// Single email notification type produced by the builder. Centralized here so
// the send path (sendReservationNotifications / sendReservationRequestEmail) and
// the resend path (resendEmailNotification) share ONE definition of recipient,
// subject and rendered body per notification_type — issue #87. Resending now
// re-renders from current reservation data instead of replaying frozen html.
export type EmailNotificationType =
  | "reservado_cliente"
  | "pendiente_cliente"
  | "pendiente_localiza"
  | "sin_disponibilidad_cliente"
  | "seguro_total_localiza"
  | "extras_localiza"
  | "mensualidad_cliente"
  | "mensualidad_localiza"
  | "solicitud_reserva";

interface EmailSpec {
  to: string;
  subject: string;
  html: string;
  bcc?: string;
}

// Reservation context returned by fetchReservationContext (admin `select *` plus
// joined relations). Modeled loosely because the joined shape is not in the
// generated DB types; the builder narrows the fields it reads.
type ReservationContext = Awaited<ReturnType<typeof fetchReservationContext>>;

interface BuilderContext {
  reservation: ReservationContext;
  branding: FranchiseBranding;
  localizaEmail: string | undefined;
  localizaBcc: string | undefined;
}

// Builds the spec for ONE notification type from current data, or null when the
// type does not apply (e.g. a Localiza type while LOCALIZA_NOTIFICATION_EMAIL is
// unset). Pure render: never calls sendEmail. The render await happens inside so
// callers always receive freshly rendered html.
async function buildEmailSpec(
  type: EmailNotificationType,
  ctx: BuilderContext
): Promise<EmailSpec | null> {
  const { reservation, branding, localizaEmail, localizaBcc } = ctx;

  const customer = reservation.customers as {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  const customerName = `${customer.first_name} ${customer.last_name}`;
  const customerEmail = customer.email;
  const pickupLoc = (reservation.pickup_location ?? {}) as {
    name?: string;
    code?: string;
    pickup_address?: string;
    pickup_map?: string;
  };
  const returnLoc = (reservation.return_location ?? {}) as {
    name?: string;
    code?: string;
    pickup_address?: string;
    pickup_map?: string;
    return_address?: string | null;
    return_map?: string | null;
  };
  const pickupLocation = pickupLoc.name ?? "";
  const returnLocation = returnLoc.name ?? "";
  const categoryName = reservation.category_code;

  const rentalCompany = (reservation.rental_companies ?? {}) as {
    extra_driver_day_price?: number | string;
    wash_price?: number | string;
    wash_onsite_price?: number | string;
    wash_deep_price?: number | string;
    wash_deep_upholstery_price?: number | string;
  };

  switch (type) {
    case "reservado_cliente": {
      const pickupAddress = pickupLoc.pickup_address ?? "";
      const pickupMapUrl = safeMapUrlOrWarn(pickupLoc.pickup_map ?? "", pickupLoc.code);
      const returnPair = resolveReturnPair(returnLoc);
      const returnAddress = returnPair.address;
      const returnMapUrl = safeMapUrlOrWarn(returnPair.mapRaw, returnLoc.code);

      const html = await renderEmail(
        ReservedClientEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupAddress,
          pickupMapUrl,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnAddress,
          returnMapUrl,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          reserveCode: reservation.reservation_code ?? "",
          totalPrice: reservation.total_price,
          taxFee: reservation.tax_fee,
          ivaFee: reservation.iva_fee,
          totalPriceToPay: reservation.total_price_to_pay,
          totalInsurance: reservation.total_insurance,
          extraDriver: reservation.extra_driver,
          babySeat: reservation.baby_seat,
          wash: reservation.wash,
          extraDriverDayPrice: Number(rentalCompany.extra_driver_day_price ?? 0),
          washPrice: Number(rentalCompany.wash_price ?? 0),
          washOnsitePrice: Number(rentalCompany.wash_onsite_price ?? 0),
          washDeepPrice: Number(rentalCompany.wash_deep_price ?? 0),
          washDeepUpholsteryPrice: Number(rentalCompany.wash_deep_upholstery_price ?? 0),
        })
      );
      return { to: customerEmail, subject: "Reserva Aprobada", html };
    }

    case "pendiente_cliente": {
      const html = await renderEmail(
        PendingClientEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
        })
      );
      return { to: customerEmail, subject: "Reserva Pendiente", html };
    }

    case "pendiente_localiza": {
      if (!localizaEmail) return null;
      const html = await renderEmail(
        PendingLocalizaEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          reserveCode: reservation.reservation_code,
          extraDriver: reservation.extra_driver,
          babySeat: reservation.baby_seat,
          wash: reservation.wash,
          totalInsurance: reservation.total_insurance,
        })
      );
      return {
        to: localizaEmail,
        subject: "Notificación de reserva en espera",
        html,
        bcc: localizaBcc,
      };
    }

    case "sin_disponibilidad_cliente": {
      const html = await renderEmail(
        FailedClientEmail({
          ...branding,
          customerName,
          categoryName,
          pickupDate: formatDate(reservation.pickup_date),
          returnDate: formatDate(reservation.return_date),
          pickupLocation,
        })
      );
      return { to: customerEmail, subject: "Reserva Sin Disponibilidad", html };
    }

    case "seguro_total_localiza": {
      if (!localizaEmail) return null;
      const html = await renderEmail(
        TotalInsuranceLocalizaEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          reserveCode: reservation.reservation_code,
          extraDriver: reservation.extra_driver,
          babySeat: reservation.baby_seat,
          wash: reservation.wash,
        })
      );
      return {
        to: localizaEmail,
        subject: "Notificación de reserva con seguro total",
        html,
        bcc: localizaBcc,
      };
    }

    case "extras_localiza": {
      if (!localizaEmail) return null;
      const html = await renderEmail(
        ExtrasLocalizaEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          reserveCode: reservation.reservation_code,
          extraDriver: reservation.extra_driver,
          babySeat: reservation.baby_seat,
          wash: reservation.wash,
        })
      );
      return {
        to: localizaEmail,
        subject: "Notificación de reserva con servicios adicionales",
        html,
        bcc: localizaBcc,
      };
    }

    case "mensualidad_cliente": {
      const html = await renderEmail(
        MonthlyClientEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          monthlyMileage: reservation.monthly_mileage,
        })
      );
      return {
        to: customerEmail,
        subject: "Solicitud de reserva mensual recibida",
        html,
      };
    }

    case "mensualidad_localiza": {
      if (!localizaEmail) return null;
      const html = await renderEmail(
        MonthlyLocalizaEmail({
          ...branding,
          customerName,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
          monthlyMileage: reservation.monthly_mileage,
          extraDriver: reservation.extra_driver,
          babySeat: reservation.baby_seat,
          wash: reservation.wash,
          totalInsurance: reservation.total_insurance,
        })
      );
      return {
        to: localizaEmail,
        subject: "Notificación de reserva mensual",
        html,
        bcc: localizaBcc,
      };
    }

    case "solicitud_reserva": {
      const html = await renderEmail(
        ReservationRequestEmail({
          ...branding,
          customerName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          categoryName,
          pickupLocation,
          pickupDate: formatDate(reservation.pickup_date),
          pickupHour: formatHour(reservation.pickup_hour),
          returnLocation,
          returnDate: formatDate(reservation.return_date),
          returnHour: formatHour(reservation.return_hour),
          selectedDays: reservation.selected_days,
        })
      );
      return {
        to: customer.email,
        subject: "Solicitud de reserva en proceso",
        html,
      };
    }
  }
}

// Which email notification types fire for a given status + reservation flags.
// This is the single place that gates types by status; both send and resend
// rely on buildEmailSpec for the actual recipient/subject/body, so behavior
// stays identical to the prior inline branches.
function emailTypesForStatus(
  status: ReservationStatus,
  reservation: ReservationContext
): EmailNotificationType[] {
  const types: EmailNotificationType[] = [];

  if (status === "reservado") types.push("reservado_cliente");
  if (status === "pendiente") {
    types.push("pendiente_cliente", "pendiente_localiza");
  }
  if (status === "sin_disponibilidad") types.push("sin_disponibilidad_cliente");

  // Total insurance notification to Localiza (independent of status).
  if (reservation.total_insurance) types.push("seguro_total_localiza");

  // Extras notification to Localiza (extra_driver, baby_seat, wash — without total insurance).
  const hasExtras =
    reservation.extra_driver || reservation.baby_seat || reservation.wash;
  if (hasExtras && !reservation.total_insurance) types.push("extras_localiza");

  if (status === "mensualidad") {
    types.push("mensualidad_cliente", "mensualidad_localiza");
  }

  return types;
}

export async function sendReservationNotifications(
  reservationId: string,
  status: ReservationStatus,
  franchiseCode: string
): Promise<void> {
  try {
    const reservation = await fetchReservationContext(reservationId);
    const ctx = await getFranchiseContext(franchiseCode);
    const { branding, attachments } = await prepareLogoForEmail(ctx.branding);

    const builderCtx: BuilderContext = {
      reservation,
      branding,
      localizaEmail: process.env.LOCALIZA_NOTIFICATION_EMAIL,
      localizaBcc: resolveLocalizaBcc(ctx.localizaBccEmail),
    };

    for (const type of emailTypesForStatus(status, reservation)) {
      const spec = await buildEmailSpec(type, builderCtx);
      if (!spec) continue;
      await sendEmail({
        franchise: franchiseCode,
        to: spec.to,
        subject: spec.subject,
        html: spec.html,
        bcc: spec.bcc,
        reservationId,
        notificationType: type,
        attachments,
      });
    }
  } catch (error) {
    console.error(
      `[email] Failed to send notifications for reservation ${reservationId}:`,
      error
    );
  }
}

export async function sendReservationRequestEmail(
  reservationId: string,
  franchiseCode: string
): Promise<void> {
  try {
    const reservation = await fetchReservationContext(reservationId);
    const ctx = await getFranchiseContext(franchiseCode);
    const { branding, attachments } = await prepareLogoForEmail(ctx.branding);

    const spec = await buildEmailSpec("solicitud_reserva", {
      reservation,
      branding,
      localizaEmail: process.env.LOCALIZA_NOTIFICATION_EMAIL,
      localizaBcc: resolveLocalizaBcc(ctx.localizaBccEmail),
    });
    if (!spec) return;

    await sendEmail({
      franchise: franchiseCode,
      to: spec.to,
      subject: spec.subject,
      html: spec.html,
      bcc: spec.bcc,
      reservationId,
      notificationType: "solicitud_reserva",
      attachments,
    });
  } catch (error) {
    console.error(
      `[email] Failed to send reservation request email for ${reservationId}:`,
      error
    );
  }
}

const EMAIL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set<EmailNotificationType>([
  "reservado_cliente",
  "pendiente_cliente",
  "pendiente_localiza",
  "sin_disponibilidad_cliente",
  "seguro_total_localiza",
  "extras_localiza",
  "mensualidad_cliente",
  "mensualidad_localiza",
  "solicitud_reserva",
]);

// Resend a SINGLE email notification type, re-rendered from CURRENT reservation
// and franchise data (issue #87). Only the requested type is re-fired, so
// resending a client email never re-notifies Localiza siblings. Recipient and
// subject are re-derived live, not replayed from the frozen log. Returns
// { ok: false } for unknown/legacy types so the caller can fall back to the
// stored html snapshot.
export async function resendEmailNotification(
  reservationId: string,
  notificationType: string,
  franchiseCode: string
): Promise<{ ok: boolean }> {
  if (!EMAIL_NOTIFICATION_TYPES.has(notificationType)) {
    return { ok: false };
  }

  const reservation = await fetchReservationContext(reservationId);
  const ctx = await getFranchiseContext(franchiseCode);
  const { branding, attachments } = await prepareLogoForEmail(ctx.branding);

  const spec = await buildEmailSpec(notificationType as EmailNotificationType, {
    reservation,
    branding,
    localizaEmail: process.env.LOCALIZA_NOTIFICATION_EMAIL,
    localizaBcc: resolveLocalizaBcc(ctx.localizaBccEmail),
  });
  if (!spec) return { ok: false };

  await sendEmail({
    franchise: franchiseCode,
    to: spec.to,
    subject: spec.subject,
    html: spec.html,
    bcc: spec.bcc,
    reservationId,
    notificationType: notificationType + "_reenvio",
    attachments,
  });

  return { ok: true };
}
