import { createClient } from "@/lib/supabase/server";

export async function getNotificationLogs(reservationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_logs")
    .select("*")
    .eq("reservation_id", reservationId)
    .order("sent_at", { ascending: false });

  if (error) throw error;
  return data;
}
