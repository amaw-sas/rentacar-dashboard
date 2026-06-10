import { NextResponse } from "next/server";
import spec from "@/docs/apidog-rentacar-api.json";

// The spec is a build-time bundled JSON import (no env, network, or per-request
// input), so a static/cacheable response is correct here — no `force-dynamic`.
// A stable, fetchable contract for the MCP server (#72) and any agent.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export async function GET() {
  return NextResponse.json(spec, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
