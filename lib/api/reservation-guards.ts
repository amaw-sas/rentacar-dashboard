import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Anti-abuse guards for reservation creation.
 *
 * Context: `createReservation` (the shared service) is reachable from the public
 * `POST /api/reservations` route AND the in-process MCP/chat funnel. Both were
 * unthrottled. On 27→28 Jun 2026 the chat self-play eval drove 165 synthetic
 * reservations across 33 fake identities in ~14h (one identity alone: 19). These
 * guards add the missing controls — per-IP and per-identity fixed-window rate
 * limits + short-window dedup of identical bookings — IN THE SERVICE, so every
 * funnel is covered.
 *
 * Design invariant: every guard FAILS OPEN. A DB hiccup must never block a real
 * booking (lost revenue is worse than a rare un-throttled abuse attempt). Errors
 * are logged, then the booking proceeds.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RateLimitConfig {
  /** Max reservation attempts per client IP per rolling hour. */
  ipPerHour: number;
  /** Max reservation attempts per identification_number per rolling hour. */
  docPerHour: number;
  /** Window (seconds) within which an identical booking is treated as a dup. */
  dedupWindowSeconds: number;
}

function intEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Load thresholds from env with safe defaults anchored to the production
 * baseline (~1.1 reservations/customer/day; legit max a handful). Defaults sit
 * well above legitimate use so real customers are never throttled.
 */
export function loadRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitConfig {
  return {
    ipPerHour: intEnv(env.RESERVATION_RATE_LIMIT_IP_PER_HOUR, 15),
    docPerHour: intEnv(env.RESERVATION_RATE_LIMIT_DOC_PER_HOUR, 5),
    dedupWindowSeconds: intEnv(env.RESERVATION_DEDUP_WINDOW_SECONDS, 600),
  };
}

/**
 * Resolve the client IP from proxy headers. Vercel sets `x-forwarded-for` as a
 * comma-separated chain; the left-most entry is the original client. Falls back
 * to `x-real-ip`, then a literal "unknown" (a missing IP is itself suspicious,
 * so bucketing all unknowns together is acceptable).
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

/**
 * Fixed-window rate-limit check via the check_rate_limit RPC (migration 072).
 * Returns true when the request is ALLOWED. FAIL-OPEN on any error.
 */
export async function checkRateLimit(
  supabase: AdminClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error(
        `[reservation-guard] rate-limit RPC error for ${key}:`,
        error.message,
      );
      return true; // fail-open
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row as { allowed?: boolean } | null)?.allowed ?? true;
  } catch (err) {
    console.error(`[reservation-guard] rate-limit threw for ${key}:`, err);
    return true; // fail-open
  }
}

export interface DuplicateKey {
  customerId: string;
  pickupDate: string;
  returnDate: string;
  categoryCode: string;
  franchise: string;
  withinSeconds: number;
}

export interface DuplicateMatch {
  id: string;
  reservation_code: string | null;
  status: string;
}

/**
 * Find a NON-cancelled reservation identical on
 * (customer, pickup_date, return_date, category, franchise) created within the
 * window — an accidental double-submit or bot resubmit. Returns the match or
 * null. FAIL-OPEN on error (returns null → booking proceeds).
 *
 * Complements the #99/#138 proxy/DB idempotency, which only catch a same
 * reserveCode race; this catches DISTINCT identical bookings minutes apart
 * (each with its own reserveCode) BEFORE the Localiza proxy is even called.
 *
 * A previously CANCELLED identical reservation is intentionally ignored so a
 * customer who cancelled can re-book the same dates.
 */
export async function findRecentDuplicate(
  supabase: AdminClient,
  key: DuplicateKey,
): Promise<DuplicateMatch | null> {
  try {
    const since = new Date(Date.now() - key.withinSeconds * 1000).toISOString();
    const { data, error } = await supabase
      .from("reservations")
      .select("id, reservation_code, status")
      .eq("customer_id", key.customerId)
      .eq("pickup_date", key.pickupDate)
      .eq("return_date", key.returnDate)
      .eq("category_code", key.categoryCode)
      .eq("franchise", key.franchise)
      .neq("status", "cancelado")
      .gte("created_at", since)
      .limit(1);
    if (error) {
      console.error("[reservation-guard] dedup query error:", error.message);
      return null; // fail-open
    }
    return (data?.[0] as DuplicateMatch | undefined) ?? null;
  } catch (err) {
    console.error("[reservation-guard] dedup threw:", err);
    return null; // fail-open
  }
}
