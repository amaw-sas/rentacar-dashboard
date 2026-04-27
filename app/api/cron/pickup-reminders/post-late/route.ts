import { handlePickupReminderCron } from "@/lib/reminders/cron-handler";

export async function GET(request: Request) {
  return handlePickupReminderCron(request, "post-late");
}
