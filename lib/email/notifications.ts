import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "./send";
import { renderEmail } from "./render";
import { ReservedClientEmail } from "./templates/reserved-client";
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
import { FRANCHISE_BRANDING } from "@/lib/constants/franchises";

interface ReservationData {
  id: string;
  franchise: string;
  reservation_code?: string | null;
  customer_id: string;
  category_code: string;
  pickup_location_id: string;
  pickup_date: string;
  pickup_hour: string;
  return_location_id: string;
  return_date: string;
  return_hour: string;
  selected_days: number;
  total_price: number;
  total_price_to_pay: number;
  tax_fee: number;
  iva_fee: number;
  total_insurance: number;
  extra_driver: boolean;
  baby_seat: boolean;
  wash: boolean;
}

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
      pickup_location:locations!pickup_location_id (name),
      return_location:locations!return_location_id (name),
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

async function getFranchiseBranding(
  franchiseCode: string
): Promise<FranchiseBranding> {
  const supabase = createAdminClient();
  const { data: franchise } = await supabase
    .from("franchises")
    .select("display_name, phone, whatsapp, logo_url, website")
    .eq("code", franchiseCode)
    .single();

  const branding = FRANCHISE_BRANDING[franchiseCode] ?? {
    color: "#18181b",
    website: "",
  };

  return {
    franchiseName: franchise?.display_name ?? franchiseCode,
    franchiseColor: branding.color,
    franchiseWebsite: franchise?.website ?? branding.website,
    franchisePhone: franchise?.phone ?? "",
    franchiseWhatsapp: franchise?.whatsapp || undefined,
    franchiseLogo: franchise?.logo_url || undefined,
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

const delay = () => new Promise((resolve) => setTimeout(resolve, parseInt(process.env.EMAIL_DELAY_MS || "5000")));

export async function sendReservationNotifications(
  reservationId: string,
  status: ReservationStatus,
  franchiseCode: string
): Promise<void> {
  try {
    const reservation = await fetchReservationContext(reservationId);
    const branding = await getFranchiseBranding(franchiseCode);

    const customer = reservation.customers as {
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
    };
    const customerName = `${customer.first_name} ${customer.last_name}`;
    const customerEmail = customer.email;
    const pickupLocation = (reservation.pickup_location as { name: string })?.name ?? "";
    const returnLocation = (reservation.return_location as { name: string })?.name ?? "";
    const categoryName = reservation.category_code;

    const rentalCompany = (reservation.rental_companies ?? {}) as {
      extra_driver_day_price?: number | string;
      wash_price?: number | string;
      wash_onsite_price?: number | string;
      wash_deep_price?: number | string;
      wash_deep_upholstery_price?: number | string;
    };

    const localizaEmail = process.env.LOCALIZA_NOTIFICATION_EMAIL;
    const localizaBcc = process.env.LOCALIZA_NOTIFICATION_BCC_EMAIL;

    if (status === "reservado") {
      const { html, text } = await renderEmail(
        ReservedClientEmail({
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

      await sendEmail({
        franchise: franchiseCode,
        to: customerEmail,
        subject: "Reserva Aprobada",
        html,
        text,
        reservationId,
        notificationType: "reservado_cliente",
      });
    }

    if (status === "pendiente") {
      const { html: clientHtml, text: clientText } = await renderEmail(
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

      await sendEmail({
        franchise: franchiseCode,
        to: customerEmail,
        subject: "Reserva Pendiente",
        html: clientHtml,
        text: clientText,
        reservationId,
        notificationType: "pendiente_cliente",
      });

      if (localizaEmail) {
        const { html: localizaHtml, text: localizaText } = await renderEmail(
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

        await delay();
        await sendEmail({
          franchise: franchiseCode,
          to: localizaEmail,
          subject: "Notificación de reserva en espera",
          html: localizaHtml,
          text: localizaText,
          bcc: localizaBcc,
          reservationId,
          notificationType: "pendiente_localiza",
        });
      }
    }

    if (status === "sin_disponibilidad") {
      const { html, text } = await renderEmail(
        FailedClientEmail({
          ...branding,
          customerName,
          categoryName,
          pickupDate: formatDate(reservation.pickup_date),
          returnDate: formatDate(reservation.return_date),
          pickupLocation,
        })
      );

      await sendEmail({
        franchise: franchiseCode,
        to: customerEmail,
        subject: "Reserva Sin Disponibilidad",
        html,
        text,
        reservationId,
        notificationType: "sin_disponibilidad_cliente",
      });
    }

    // Total insurance notification to Localiza (independent of status)
    if (reservation.total_insurance > 0 && localizaEmail) {
      const { html, text } = await renderEmail(
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

      await delay();
      await sendEmail({
        franchise: franchiseCode,
        to: localizaEmail,
        subject: "Notificación de reserva con seguro total",
        html,
        text,
        bcc: localizaBcc,
        reservationId,
        notificationType: "seguro_total_localiza",
      });
    }

    // Extras notification to Localiza (extra_driver, baby_seat, wash — without total insurance)
    const hasExtras = reservation.extra_driver || reservation.baby_seat || reservation.wash;
    if (hasExtras && reservation.total_insurance <= 0 && localizaEmail) {
      const { html, text } = await renderEmail(
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

      await delay();
      await sendEmail({
        franchise: franchiseCode,
        to: localizaEmail,
        subject: "Notificación de reserva con servicios adicionales",
        html,
        text,
        bcc: localizaBcc,
        reservationId,
        notificationType: "extras_localiza",
      });
    }

    // Monthly reservation notification to client
    if (status === "mensualidad") {
      const { html: clientHtml, text: clientText } = await renderEmail(
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

      await sendEmail({
        franchise: franchiseCode,
        to: customerEmail,
        subject: "Solicitud de reserva mensual recibida",
        html: clientHtml,
        text: clientText,
        reservationId,
        notificationType: "mensualidad_cliente",
      });
    }

    // Monthly reservation notification to Localiza
    if (status === "mensualidad" && localizaEmail) {
      await delay();
      const { html, text } = await renderEmail(
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

      await sendEmail({
        franchise: franchiseCode,
        to: localizaEmail,
        subject: "Notificación de reserva mensual",
        html,
        text,
        bcc: localizaBcc,
        reservationId,
        notificationType: "mensualidad_localiza",
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
    const branding = await getFranchiseBranding(franchiseCode);

    const customer = reservation.customers as {
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
    };
    const customerName = `${customer.first_name} ${customer.last_name}`;
    const pickupLocation = (reservation.pickup_location as { name: string })?.name ?? "";
    const returnLocation = (reservation.return_location as { name: string })?.name ?? "";
    const categoryName = reservation.category_code;

    const { html, text } = await renderEmail(
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

    await sendEmail({
      franchise: franchiseCode,
      to: customer.email,
      subject: "Solicitud de reserva en proceso",
      html,
      text,
      reservationId,
      notificationType: "solicitud_reserva",
    });
  } catch (error) {
    console.error(
      `[email] Failed to send reservation request email for ${reservationId}:`,
      error
    );
  }
}
