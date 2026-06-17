import { NextResponse } from "next/server";
import { RENTAL_REQUIREMENTS } from "@/lib/api/rental-requirements";

// Public, unauthenticated read (like GET /api/locations): rental requirements
// are already public on the brand sites, so a wildcard origin leaks nothing and
// lets browser-side agents fetch it. Abuse is bounded by the Vercel WAF rate
// limit, not a secret. Static content (no DB/env/per-request input), so a
// cacheable response is correct — no `force-dynamic`.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// The constant changes only on deploy, so let the CDN cache it generously.
const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  return NextResponse.json(RENTAL_REQUIREMENTS, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
