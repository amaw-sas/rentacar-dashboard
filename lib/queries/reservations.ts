import { createClient } from "@/lib/supabase/server";
import { bogotaDayStartISO, bogotaDayEndISO } from "@/lib/date/bogota";
import { UNKNOWN_FILTER } from "@/lib/attribution/channel-meta";
import {
  SEARCH_COLUMNS,
  type ReservationListParams,
} from "@/lib/reservations/list-params";

const RESERVATION_SELECT = `
  *,
  customers(first_name, last_name, identification_type, identification_number, phone, email),
  rental_companies(name),
  pickup_location:locations!pickup_location_id(name, city_id, cities(id, name)),
  return_location:locations!return_location_id(name),
  referrals(id, name, code)
`;

const RESERVATION_LIBRO_SELECT = `
  *,
  customers(first_name, last_name, identification_number, phone, email),
  rental_companies(name),
  pickup_location:locations!pickup_location_id(name, pickup_address, return_address, pickup_map, return_map, city),
  return_location:locations!return_location_id(name, pickup_address, return_address, pickup_map, return_map, city),
  referrals(id, name, code)
`;

// Builds the PostgREST `or()` expression for snapshot-keyed search (issue #26).
// `*term*` is PostgREST's ilike wildcard form; the term is pre-sanitized in
// parseListParams (no `,()*%`) so it cannot break the comma-separated filter
// list or inject wildcards.
function searchOrExpr(term: string): string {
  const pattern = `*${term}*`;
  return SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`).join(",");
}

// Issue #105: the count strategy gates on table size. count:exact runs a second
// full Seq Scan (the filtered COUNT(*)) on every list render — ~7.6ms at 13k,
// scaling linearly (~60ms at 100k). Below the threshold that's noise and we keep
// exact totals; at/above it we switch to PostgREST's planned count (planner
// estimate, no scan) and the header renders "~N" (the `approximate` flag).
const PLANNED_COUNT_THRESHOLD = 100_000;

// reltuples is slow-moving and only gates a coarse threshold, so we cache it.
// Without this, every render would pay an extra RPC round-trip to skip a count
// we aren't even skipping yet (< 100k) — a net regression today. Per-instance
// staleness of minutes near the boundary is irrelevant to a 100k gate.
//
// The cache is intentionally a single module-level value shared across requests:
// reltuples is a whole-table statistic, independent of the caller or any RLS
// filter, so there is nothing per-user to leak. Do NOT copy this shape for a
// value that varies by request/tenant.
const ROW_ESTIMATE_TTL_MS = 5 * 60_000;
let rowEstimateCache: { value: number; at: number } | null = null;

// Test-only: clears the module-level estimate cache so cases can exercise both
// sides of the gate independently.
export function __resetReservationsRowEstimateCache() {
  rowEstimateCache = null;
}

// Planner row estimate for reservations (reltuples), via the #105 RPC. Instant —
// no scan — which is the point: probing the size must not cost what the planned
// count saves. Fails open to 0 (→ exact, today's behavior) so a stats probe can
// never break the list; the failure isn't cached, so the next render retries.
async function reservationsRowEstimate(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<number> {
  const now = Date.now();
  if (rowEstimateCache && now - rowEstimateCache.at < ROW_ESTIMATE_TTL_MS) {
    return rowEstimateCache.value;
  }
  const { data, error } = await supabase.rpc("reservations_estimated_count");
  if (error) {
    // Surface the degradation: a persistent error here (e.g. the #060 migration
    // missing in an env) silently pins the list to exact. Don't cache it, so the
    // next render retries.
    console.warn("reservations_estimated_count probe failed:", error.message);
    return 0;
  }
  // Fold a never-analyzed sentinel (-1, already clamped in SQL) or any malformed
  // non-finite body to 0 → exact, and keep NaN out of the cache so the
  // retry-on-failure invariant holds for a malformed success too.
  const value = Number(data ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  rowEstimateCache = { value, at: now };
  return value;
}

// Server-side paginated/filtered/sorted reservations list (issue #100). Returns
// exactly one page of rows plus the total for pagination, instead of the whole
// table — the previous unbounded fetch shipped ~26 MB (13k rows) to the client
// on every list render and save. `approximate` is true when the total comes
// from the planned count (#105) instead of an exact COUNT(*).
export async function getReservationsPage(params: ReservationListParams) {
  const supabase = await createClient();

  // Kick off the size probe concurrently with the (optional) city resolution
  // below — on a cache hit it resolves instantly; on a miss it overlaps the
  // locations round-trip instead of serializing behind it.
  const estimatePromise = reservationsRowEstimate(supabase);

  // City lives on locations, not reservations. Resolve the city to its pickup
  // location ids (≤32 locations) and filter reservations by them — keeps the
  // pickup_location embed a LEFT join (no `!inner`), so non-city filters still
  // return reservations with a null pickup_location. An empty id list yields no
  // rows, which is correct for a city with no locations.
  let pickupLocationIds: string[] | null = null;
  if (params.cityId) {
    const { data: locs, error: locErr } = await supabase
      .from("locations")
      .select("id")
      .eq("city_id", params.cityId);
    if (locErr) throw locErr;
    pickupLocationIds = (locs ?? []).map((l) => l.id as string);
  }

  // count:planned returns the planner's estimate for the FILTERED query, which is
  // routinely wrong for selective predicates — an undercount makes rows past the
  // estimated last page unreachable, an overcount yields phantom empty pages. So
  // planned is only safe on the unfiltered "browse all" path, where it ≈ the
  // whole-table reltuples and is accurate. Any narrowing filter/search keeps the
  // exact count, which is cheap on a small filtered set. (Issue #105.)
  const hasNarrowingQuery = Boolean(
    params.franchise ||
      params.status ||
      params.referralId ||
      params.cityId ||
      params.createdFrom ||
      params.createdTo ||
      params.pickupFrom ||
      params.pickupTo ||
      params.attributionChannel ||
      params.search,
  );

  const estimate = await estimatePromise;
  const countMode: "exact" | "planned" =
    estimate >= PLANNED_COUNT_THRESHOLD && !hasNarrowingQuery
      ? "planned"
      : "exact";

  let q = supabase
    .from("reservations")
    .select(RESERVATION_SELECT, { count: countMode });

  if (params.franchise) q = q.eq("franchise", params.franchise);
  if (params.status) q = q.eq("status", params.status);
  if (params.referralId) q = q.eq("referral_id", params.referralId);
  if (pickupLocationIds) q = q.in("pickup_location_id", pickupLocationIds);
  // created_at is timestamptz; the URL stores a Colombia civil date. Anchoring
  // the bounds to America/Bogota (UTC-5) — not bare UTC dates — keeps the filter
  // aligned with the "Creado" column, which renders in Colombia time. Otherwise
  // a reservation created 19:00–24:00 Colombia (= next UTC day) leaks into the
  // following day's range. Issue #115; helpers shared with the dashboard (#114).
  if (params.createdFrom)
    q = q.gte("created_at", bogotaDayStartISO(params.createdFrom));
  if (params.createdTo) q = q.lte("created_at", bogotaDayEndISO(params.createdTo));
  if (params.pickupFrom) q = q.gte("pickup_date", params.pickupFrom);
  if (params.pickupTo) q = q.lte("pickup_date", params.pickupTo);
  // Origen filter (issue #113): the "Desconocido" sentinel means the channel was
  // never captured (IS NULL); a concrete channel is an exact match. Distinct ops
  // because PostgREST `.eq(col, null)` would not produce `IS NULL`.
  if (params.attributionChannel === UNKNOWN_FILTER) {
    q = q.is("attribution_channel", null);
  } else if (params.attributionChannel) {
    q = q.eq("attribution_channel", params.attributionChannel);
  }
  if (params.search) q = q.or(searchOrExpr(params.search));

  // Priority statuses always lead (is_priority generated column), then the
  // requested/default sort, then id as a stable tiebreaker so pagination is
  // deterministic when the sort column has ties.
  q = q
    .order("is_priority", { ascending: false })
    .order(params.sort.column, { ascending: params.sort.ascending })
    .order("id", { ascending: true });

  const from = (params.page - 1) * params.pageSize;
  q = q.range(from, from + params.pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: data ?? [],
    total: count ?? 0,
    approximate: countMode === "planned",
  };
}

export async function getCustomerReservations(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getReferralReservations(referralId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("referral_id", referralId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getReservation(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function getReservationForLibro(id: string) {
  const supabase = await createClient();
  const { data: reservation, error } = await supabase
    .from("reservations")
    .select(RESERVATION_LIBRO_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  if (!reservation) return null;

  const { data: category } = await supabase
    .from("vehicle_categories")
    .select("id, name, image_url")
    .eq("code", reservation.category_code)
    .maybeSingle();

  let models: Array<{
    image_url: string | null;
    is_default: boolean;
    status: string;
  }> = [];
  if (category?.id) {
    const { data: modelData } = await supabase
      .from("category_models")
      .select("image_url, is_default, status")
      .eq("category_id", category.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    models = modelData ?? [];
  }

  return { reservation, category, models };
}
