import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Hard ceiling on the auth round-trip. getUser() is a network call to Supabase
// Auth (GoTrue); p99 is ~600ms, but a hung call used to pin the whole middleware
// open until Vercel killed it (MIDDLEWARE_INVOCATION_TIMEOUT → 504). We fail
// closed (treat as logged-out → redirect to /login) well under the platform
// limit so a transient auth hiccup degrades to a clean re-login, not a 504.
const AUTH_TIMEOUT_MS = 8000;

// Pure auth decision — given the resolved user and the requested path, where (if
// anywhere) must we redirect? Extracted so the branching is unit-testable without
// the Edge runtime (SCEN-A/B/C). Returns the target path, or null to proceed.
export function authRedirectPath(
  user: unknown | null,
  pathname: string,
): "/login" | "/" | null {
  const isLoginPage = pathname === "/login";
  if (!user && !isLoginPage) return "/login";
  if (user && isLoginPage) return "/";
  return null;
}

// Resolves the session user with a timeout. A hang or error resolves to a null
// user (fail closed) rather than rejecting, so the caller always gets an answer
// within AUTH_TIMEOUT_MS.
async function getUserWithTimeout(
  supabase: ReturnType<typeof createServerClient>,
): Promise<unknown | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<{ data: { user: null } }>((resolve) => {
        timer = setTimeout(
          () => resolve({ data: { user: null } }),
          AUTH_TIMEOUT_MS,
        );
      }),
    ]);
    return result.data.user;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Single source of session auth for the dashboard. Refreshes the Supabase session
// cookies AND enforces the redirect rules in ONE getUser() round-trip. The
// previous split (updateSession + a second client/getUser in middleware.ts) made
// two sequential network calls per request, which — multiplied by Next.js <Link>
// prefetching — flooded GoTrue and tipped the middleware into 504s.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const user = await getUserWithTimeout(supabase);

  const target = authRedirectPath(user, request.nextUrl.pathname);
  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // Carry over any session cookies refreshed during getUser() so the redirect
    // doesn't drop a freshly-rotated token.
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  }

  return supabaseResponse;
}
