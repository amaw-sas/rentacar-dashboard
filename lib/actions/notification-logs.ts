"use server";

import { createClient } from "@/lib/supabase/server";

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
    const supabase = await createClient();
    await supabase.from("notification_logs").insert(data);
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

    if (log.channel !== "email" || !log.html_content) {
      return { error: "Solo se pueden reenviar notificaciones de email" };
    }

    // Get franchise from reservation
    const { data: reservation } = await supabase
      .from("reservations")
      .select("franchise")
      .eq("id", log.reservation_id)
      .single();

    if (!reservation?.franchise) {
      return { error: "No se pudo determinar la franquicia" };
    }

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
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al reenviar" };
  }
}
