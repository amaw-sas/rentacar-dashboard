import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Exported for the issue-#72 middleware-prefix test (SCEN-107). Next.js only
// consumes the `middleware` and `config` exports — this named export is inert.
export const PUBLIC_API_PREFIXES = [
  "/api/reservations",
  "/api/cron",
  "/api/upload",
  "/api/locations",
  "/api/requirements",
  "/api/openapi",
  "/api/mcp",
  "/api/chat",
];

export async function middleware(request: NextRequest) {
  // Public API routes — bypass session auth. /api/reservations, /api/cron and
  // /api/upload authenticate via x-api-key; /api/locations, /api/requirements,
  // /api/openapi and /api/mcp are fully public (no key). /api/mcp is anonymous by
  // design (issue #172): anti-abuse is the signed/expiring quote + Vercel Firewall
  // rate-limit, not a shared secret. /api/locations etc. expose data already
  // public on the brand sites.
  if (PUBLIC_API_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // updateSession refreshes the session cookies AND enforces the login/redirect
  // rules in a single getUser() round-trip — see lib/supabase/middleware.ts. The
  // old second client + second getUser here doubled the auth load on every
  // request (and every Next.js prefetch), which drove the MIDDLEWARE_INVOCATION
  // _TIMEOUT 504s on the dashboard.
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
