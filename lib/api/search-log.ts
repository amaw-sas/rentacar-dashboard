import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Producer for `search_logs` (issue #206). The availability route is a pure
 * passthrough to the Localiza proxy; this module is the long-missing INSERT that
 * migration 009 reserved a table for. It runs inside `after()` on the success
 * path and is fully fire-and-forget: every error is swallowed so a logging fault
 * can never reach the quoting response, which is on the funnels' critical path.
 *
 * The franchise gate is deliberate: `search_logs.franchise` is NOT NULL and the
 * route does not receive a franchise until the funnels are updated (follow-up in
 * rentacar-web / rentacar-reservas). Until then we SKIP rather than poison the
 * key analytics dimension with a sentinel.
 */

// Optional logging context the funnels MAY send alongside the quote request.
// Validated at the route boundary (Zod-at-the-boundary convention). All optional
// so the current 4-field funnel payloads stay backward-compatible.
export const searchLogContextSchema = z.object({
  franchise: z.string().trim().min(1).optional(),
  referralCode: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  isMonthly: z.boolean().optional(),
});

export type SearchLogContext = z.infer<typeof searchLogContextSchema>;

export interface AvailabilitySearchLogInput extends SearchLogContext {
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
  /** The proxy result array, verbatim — drives `available_categories` + `total_results`. */
  availableCategories: unknown[];
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SearchLogRow {
  franchise: string;
  pickup_location_code: string;
  return_location_code: string;
  pickup_date: string;
  pickup_hour: string;
  return_date: string;
  return_hour: string;
  is_monthly: boolean;
  referral_code: string | null;
  available_categories: unknown[];
  total_results: number;
  selected_category_code: string | null;
  converted_to_reservation: boolean;
  session_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

/**
 * Split an ISO-like datetime into a Postgres `date` + `time` WITHOUT going through
 * `Date`, so a Colombia-local "2026-07-01T10:00" is never shifted by the runtime's
 * UTC offset. Tolerates a trailing seconds / timezone suffix. Returns null when the
 * shape is not parseable, so the caller skips rather than writing a corrupt row.
 */
export function splitIsoDateTime(
  iso: unknown,
): { date: string; hour: string } | null {
  if (typeof iso !== "string") return null;
  const tIdx = iso.indexOf("T");
  if (tIdx < 0) return null;
  const date = iso.slice(0, tIdx);
  const dm = date.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!dm) return null;
  // Range-check so a shape-valid but calendar/clock-invalid value (e.g.
  // "2026-13-45T24:30") is a clean skip here — not a row that the Postgres
  // date/time columns reject, which would surface as a swallowed insert error.
  const month = Number(dm[1]);
  const day = Number(dm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = iso.slice(tIdx + 1).match(/^(\d{2}):(\d{2})/);
  if (!time) return null;
  if (Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  return { date, hour: `${time[1]}:${time[2]}:00` };
}

/**
 * Pure row builder. Returns null when the row must be skipped:
 *  - no franchise (NOT NULL key dimension — never poison it), or
 *  - an unparseable pickup/return datetime.
 * `selected_category_code` / `converted_to_reservation` are post-search and stay
 * at their defaults here (set later by a separate search→reservation linking feature).
 */
export function buildSearchLogRow(
  input: AvailabilitySearchLogInput,
): SearchLogRow | null {
  const franchise = input.franchise?.trim();
  if (!franchise) return null;

  const pickup = splitIsoDateTime(input.pickupDateTime);
  const ret = splitIsoDateTime(input.returnDateTime);
  if (!pickup || !ret) return null;

  return {
    franchise,
    pickup_location_code: input.pickupLocation,
    return_location_code: input.returnLocation,
    pickup_date: pickup.date,
    pickup_hour: pickup.hour,
    return_date: ret.date,
    return_hour: ret.hour,
    is_monthly: input.isMonthly ?? false,
    referral_code: input.referralCode?.trim() || null,
    available_categories: input.availableCategories,
    total_results: input.availableCategories.length,
    selected_category_code: null,
    converted_to_reservation: false,
    session_id: input.sessionId?.trim() || null,
    user_agent: input.userAgent ?? null,
    ip_address: input.ipAddress ?? null,
  };
}

/**
 * Fire-and-forget insert. NEVER throws — intended to run inside `after()`. A skip
 * (no franchise / bad dates) and a DB error are both logged as structured lines and
 * otherwise ignored so the quoting response is unaffected.
 */
export async function logAvailabilitySearch(
  input: AvailabilitySearchLogInput,
): Promise<void> {
  try {
    const row = buildSearchLogRow(input);
    if (!row) {
      console.debug(
        JSON.stringify({
          level: "DEBUG",
          event: "search_log_skipped",
          reason: input.franchise?.trim() ? "unparseable_datetime" : "no_franchise",
        }),
      );
      return;
    }

    const supabase = createAdminClient();
    // Bound the deferred write: `after()` keeps the serverless instance (and a
    // PostgREST slot) alive until this resolves. A DB slowdown — likeliest under
    // the same high traffic that produced the search — must fail fast, not pile
    // up held-open instances. The try/catch already swallows the abort error.
    const { error } = await supabase
      .from("search_logs")
      .insert(row)
      .abortSignal(AbortSignal.timeout(5000));
    if (error) {
      console.error("[search-log] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[search-log] unexpected failure:", e);
  }
}
