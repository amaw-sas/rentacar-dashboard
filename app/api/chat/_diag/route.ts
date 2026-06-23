import { NextResponse } from "next/server";
import { hashClientIp, clientIpFromHeaders } from "@/lib/chat/client-ip";

// TEMPORARY diagnostic for Inc. 4 — confirms what the runtime sees for the per-IP
// limit (salt present? forwarded IP present? hash computed?). Returns booleans
// only, NEVER the salt or the raw IP. DELETE after diagnosing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    saltPresent: Boolean(process.env.CHAT_IP_HASH_SALT),
    reservationsEnabled: process.env.CHAT_RESERVATIONS_ENABLED === "true",
    xForwardedForPresent: Boolean(request.headers.get("x-forwarded-for")),
    xRealIpPresent: Boolean(request.headers.get("x-real-ip")),
    clientIpResolved: clientIpFromHeaders(request.headers) !== null,
    ipHashComputed: hashClientIp(request.headers) !== null,
  });
}
