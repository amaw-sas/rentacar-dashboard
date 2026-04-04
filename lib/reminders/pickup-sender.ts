import { format } from "date-fns";
import { es } from "date-fns/locale";
import { parse } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { renderEmail } from "@/lib/email/render";
import { PickupReminderEmail } from "@/lib/email/templates/pickup-reminder";
import { PostPickupReminderEmail } from "@/lib/email/templates/post-pickup-reminder";
import { addContact, sendTemplateMessage } from "@/lib/wati/client";
import {
  getWeekPickupReservations,
  getThreeDaysPickupReservations,
  getSameDayMorningReservations,
  getSameDayLateReservations,
  getPostMorningReservations,
  getPostLateReservations,
} from "./pickup-queries";
import type { ReservationRecord } from "./pickup-queries";

const FRANCHISE_BRANDING: Record<string, { color: string; website: string }> = {
  alquilatucarro: { color: "#0d6efd", website: "https://alquilatucarro.com" },
  alquilame: { color: "#dc3545", website: "https://alquilame.com" },
  alquicarros: { color: "#fd7e14", website: "https://alquicarros.com" },
};

type ReminderType =
  | "week"
  | "three-days"
  | "same-day-morning"
  | "same-day-late"
  | "post-morning"
  | "post-late";

const QUERY_MAP: Record<ReminderType, () => Promise<ReservationRecord[]>> = {
  week: getWeekPickupReservations,
  "three-days": getThreeDaysPickupReservations,
  "same-day-morning": getSameDayMorningReservations,
  "same-day-late": getSameDayLateReservations,
  "post-morning": getPostMorningReservations,
  "post-late": getPostLateReservations,
};

const WHATSAPP_TEMPLATE_MAP: Record<ReminderType, string> = {
  week: "recordatorio_recogida",
  "three-days": "recordatorio_recogida",
  "same-day-morning": "recordatorio_recogida_mismo_dia_1",
  "same-day-late": "recordatorio_recogida_mismo_dia_1",
  "post-morning": "post_reserva",
  "post-late": "post_reserva",
};

const BROADCAST_LABEL: Record<ReminderType, string> = {
  week: "R Semana",
  "three-days": "R 3 Dias",
  "same-day-morning": "R Mismo Dia AM",
  "same-day-late": "R Mismo Dia PM",
  "post-morning": "Post AM",
  "post-late": "Post PM",
};

function isPostReminder(type: ReminderType): boolean {
  return type === "post-morning" || type === "post-late";
}

function formatPickupDate(dateStr: string): string {
  const parsed = parse(dateStr, "yyyy-MM-dd", new Date());
  return format(parsed, "d 'de' MMMM 'de' yyyy", { locale: es });
}

function formatPickupHour(hourStr: string): string {
  const [h, m] = hourStr.split(":");
  const hour = parseInt(h, 10);
  const minute = m ?? "00";
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

async function getFranchiseBranding(franchiseCode: string) {
  const supabase = await createClient();
  const { data: franchise } = await supabase
    .from("franchises")
    .select("display_name, phone, logo_url, website")
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
  };
}

export async function sendPickupReminders(type: string) {
  const reminderType = type as ReminderType;
  const queryFn = QUERY_MAP[reminderType];

  if (!queryFn) {
    console.error(`[reminders] Unknown reminder type: ${type}`);
    return { sent: 0, errors: 0, total: 0 };
  }

  const reservations = await queryFn();
  console.log(
    `[reminders] ${reminderType}: found ${reservations.length} reservations`
  );

  let sent = 0;
  let errors = 0;
  const todayStr = format(new Date(), "yyyy-MM-dd");

  for (const reservation of reservations) {
    try {
      const customer = reservation.customers;
      const location = reservation.pickup_location;
      const fullName = `${customer.first_name} ${customer.last_name}`;
      const branding = await getFranchiseBranding(reservation.franchise);

      // Send email
      const isPost = isPostReminder(reminderType);

      if (isPost) {
        const html = await renderEmail(
          PostPickupReminderEmail({
            ...branding,
            customerName: fullName,
          })
        );

        await sendEmail({
          franchise: reservation.franchise,
          to: customer.email,
          subject: "¿Cómo va tu experiencia?",
          html,
        });
      } else {
        const html = await renderEmail(
          PickupReminderEmail({
            ...branding,
            customerName: fullName,
            reserveCode: reservation.reservation_code,
            pickupDate: formatPickupDate(reservation.pickup_date),
            pickupHour: formatPickupHour(reservation.pickup_hour),
            pickupLocation: location.name,
            pickupAddress: location.address ?? undefined,
          })
        );

        await sendEmail({
          franchise: reservation.franchise,
          to: customer.email,
          subject: "Recordatorio de tu reserva",
          html,
        });
      }

      // Send WhatsApp via Wati
      if (customer.phone) {
        await addContact(customer.phone, fullName);

        const templateName = WHATSAPP_TEMPLATE_MAP[reminderType];
        const broadcastName = `${BROADCAST_LABEL[reminderType]} ${todayStr}`;

        const params = isPost
          ? [
              { name: "fullname", value: fullName },
              { name: "franchise_name", value: branding.franchiseName },
            ]
          : [
              { name: "fullname", value: fullName },
              { name: "reservation_code", value: reservation.reservation_code },
              {
                name: "pickup_date",
                value: formatPickupDate(reservation.pickup_date),
              },
              {
                name: "pickup_hour",
                value: formatPickupHour(reservation.pickup_hour),
              },
              { name: "pickup_location", value: location.name },
              { name: "franchise_name", value: branding.franchiseName },
            ];

        await sendTemplateMessage(
          customer.phone,
          templateName,
          broadcastName,
          params
        );
      }

      sent++;
    } catch (error) {
      errors++;
      console.error(
        `[reminders] Failed for reservation ${reservation.id}:`,
        error
      );
    }
  }

  console.log(
    `[reminders] ${reminderType} complete: ${sent} sent, ${errors} errors, ${reservations.length} total`
  );

  return { sent, errors, total: reservations.length };
}
