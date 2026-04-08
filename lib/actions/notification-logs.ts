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
