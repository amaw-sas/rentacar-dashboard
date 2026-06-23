import { NextResponse } from "next/server";
import { hashClientIp, clientIpFromHeaders } from "@/lib/chat/client-ip";

// TEMPORARY diagnostic for Inc. 4 — booleans only, NEVER secrets. DELETE after use.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    saltPresent: Boolean(process.env.CHAT_IP_HASH_SALT),
    reservationsEnabled: process.env.CHAT_RESERVATIONS_ENABLED === "true",
    clientIpResolved: clientIpFromHeaders(request.headers) !== null,
    ipHashComputed: hashClientIp(request.headers) !== null,
  });
}
