import { NextResponse } from "next/server";
import spec from "@/docs/apidog-rentacar-api.json";

// The doc is bundled at build time, but the response must vary by request host:
// each brand domain (api.alquilame.co, api.alquicarros.com, …) self-describes so
// a Custom GPT / MCP client importing the spec from that domain calls back to the
// SAME domain instead of the bundled fallback. Hence `force-dynamic` — the body
// depends on the Host header, so it can't be statically cached.
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// Rewrite `servers` to the host that served this request so every brand domain
// points at itself. Falls back to the bundled `spec.servers` (the canonical prod
// URL) when no host is available — e.g. the SCEN-005 unit test calls GET() with
// no Request. `request` is optional for exactly that reason.
export async function GET(request?: Request) {
  const host = request?.headers.get("host");
  if (!host) {
    return NextResponse.json(spec, { headers: CORS_HEADERS });
  }
  const proto = request?.headers.get("x-forwarded-proto") ?? "https";
  return NextResponse.json(
    { ...spec, servers: [{ url: `${proto}://${host}`, description: spec.servers[0]?.description }] },
    { headers: CORS_HEADERS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
