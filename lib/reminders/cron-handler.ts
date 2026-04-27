import { NextResponse } from "next/server";
import { sendPickupReminders } from "./pickup-sender";
import type { ReminderType } from "./pickup-sender";

export async function handlePickupReminderCron(
  request: Request,
  type: ReminderType
) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await sendPickupReminders(type);
    return NextResponse.json({ ok: true, type, ...results });
  } catch (error) {
    console.error("[cron/pickup-reminders] Unhandled error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
