"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface NotificationLogData {
  reservation_id: string;
  channel: "email" | "whatsapp";
  notification_type: string;
  recipient: string;
  subject?: string;
  html_content?: string;
  status: "sent" | "failed";
  error_message?: string;
}

export async function logNotification(data: NotificationLogData): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("notification_logs").insert(data);
    if (error) {
      console.error("[notification-log] insert error:", error);
    }
  } catch (error) {
    console.error("[notification-log] Failed to log:", error);
  }
}

export async function resendNotification(
  logId: string,
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();
    const { data: log, error } = await supabase
      .from("notification_logs")
      .select("*")
      .eq("id", logId)
      .single();

    if (error || !log) {
      return { error: "Notificación no encontrada" };
    }

    // Get reservation data for resend
    const { data: reservation } = await supabase
      .from("reservations")
      .select("franchise")
      .eq("id", log.reservation_id)
      .single();

    if (!reservation?.franchise) {
      return { error: "No se pudo determinar la franquicia" };
    }

    if (log.channel === "email" && log.html_content) {
      const { sendEmail } = await import("@/lib/email/send");
      await sendEmail({
        franchise: reservation.franchise,
        to: log.recipient,
        subject: log.subject ?? "Notificación",
        html: log.html_content,
        reservationId: log.reservation_id,
        notificationType: log.notification_type + "_reenvio",
      });
      return {};
    }

    if (log.channel === "whatsapp") {
      // Status WhatsApp (transactional): whatsapp_reservado → status "reservado", etc.
      const statusMap: Record<string, string> = {
        whatsapp_reservado: "reservado",
        whatsapp_pendiente: "pendiente",
        whatsapp_sin_disponibilidad: "sin_disponibilidad",
        whatsapp_mensualidad: "mensualidad",
      };
      const status = statusMap[log.notification_type];
      if (status) {
        const { sendStatusWhatsApp } = await import("@/lib/wati/notifications");
        await sendStatusWhatsApp(
          log.reservation_id,
          status as import("@/lib/schemas/reservation").ReservationStatus,
        );
        return {};
      }

      // Pickup reminder WhatsApp: whatsapp_pre_pickup_week → ReminderType "week", etc.
      const reminderMap: Record<
        string,
        import("@/lib/reminders/pickup-sender").ReminderType
      > = {
        whatsapp_pre_pickup_week: "week",
        whatsapp_pre_pickup_3d: "three-days",
        whatsapp_pre_pickup_same_day_am: "same-day-morning",
        whatsapp_pre_pickup_same_day_pm: "same-day-late",
        whatsapp_post_pickup_am: "post-morning",
        whatsapp_post_pickup_pm: "post-late",
      };
      const reminderType = reminderMap[log.notification_type];
      if (reminderType) {
        const { sendSinglePickupReminder } = await import(
          "@/lib/reminders/pickup-sender"
        );
        await sendSinglePickupReminder(log.reservation_id, reminderType);
        return {};
      }

      return { error: "Tipo de notificación WhatsApp no reconocido" };
    }

    return { error: "No se puede reenviar esta notificación" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al reenviar" };
  }
}
