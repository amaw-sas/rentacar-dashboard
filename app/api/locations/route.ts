import { NextResponse } from "next/server";
import { getLocationDirectory } from "@/lib/api/location-directory";

// Per-request execution so a location edit in the dashboard is reflected without
// a redeploy (a GET route handler would otherwise be frozen in the Full Route
// Cache at build time). CDN freshness is governed separately by the explicit
// Cache-Control header below.
export const dynamic = "force-dynamic";
// createAdminClient() uses the node Supabase client + reads the service-role
// key; it cannot run on edge.
export const runtime = "nodejs";

// Public, unauthenticated directory. The data is already public on the brand
// sites, so a wildcard origin leaks nothing and lets browser-side agents fetch it.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// CDN TTL (not a rate limit): 5 min trims redundant origin hits while keeping a
// location edit fresh within ≤5 min. revalidatePath does NOT purge this — the
// CDN serves the cached copy until the TTL expires.
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

export async function GET() {
  try {
    const locations = await getLocationDirectory();
    return NextResponse.json(
      { count: locations.length, locations },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": CACHE_CONTROL,
        },
      },
    );
  } catch (error) {
    console.error("[locations] Failed to load directory:", error);
    return NextResponse.json(
      { error: "Error al cargar el directorio de sedes" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
