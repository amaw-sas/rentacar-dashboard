import { NextResponse } from "next/server";
import { FRANCHISES } from "@/lib/schemas/reservation";
import { isChatEnabledForBrand } from "@/lib/chat/brand-status";

// Public, anonymous status endpoint for the chat widget (rentacar-web, cross-origin):
// reports whether the chat is enabled for a brand so the widget can show/hide itself.
// Mirrors the public-read + wildcard-CORS pattern of /api/chat and shares its gate
// (CHAT_BRAND_SWITCH), so while the switch is inert this always reports enabled.
// Already public via middleware (PUBLIC_API_PREFIXES includes "/api/chat").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export async function GET(request: Request) {
  const brand = new URL(request.url).searchParams.get("brand");
  if (!brand || !FRANCHISES.includes(brand as (typeof FRANCHISES)[number])) {
    return NextResponse.json(
      { error: "Parámetro 'brand' inválido" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const enabled = await isChatEnabledForBrand(brand);
  return NextResponse.json({ brand, enabled }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
