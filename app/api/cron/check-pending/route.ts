import { NextResponse } from "next/server";
import { checkPendingReservationStatuses } from "@/lib/reminders/check-pending-status";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkPendingReservationStatuses();

  return NextResponse.json(result);
}
