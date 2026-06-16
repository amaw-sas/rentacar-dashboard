import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";

// Exported for the issue-#72 middleware-prefix test (SCEN-107). Next.js only
// consumes the `middleware` and `config` exports — this named export is inert.
export const PUBLIC_API_PREFIXES = [
  "/api/reservations",
  "/api/cron",
  "/api/upload",
  "/api/locations",
  "/api/openapi",
  "/api/mcp",
];

export async function middleware(request: NextRequest) {
  // Public API routes — bypass session auth. /api/reservations, /api/cron,
  // /api/upload and /api/mcp authenticate via x-api-key (the MCP server checks
  // it through withMcpAuth → verifyApiKey, issue #72); /api/locations and
  // /api/openapi are fully public (no key — data already public on brand sites).
  if (PUBLIC_API_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const response = await updateSession(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!user && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
