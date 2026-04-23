import { NextRequest, NextResponse } from "next/server";
import { sendPickupReminders } from "@/lib/reminders/pickup-sender";

const VALID_TYPES = [
  "week",
  "three-days",
  "same-day-morning",
  "same-day-late",
  "post-morning",
  "post-late",
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type } = await params;

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
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
