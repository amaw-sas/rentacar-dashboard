import { createClient } from "@/lib/supabase/server";
import { bogotaDayStartISO, bogotaDayEndISO } from "@/lib/date/bogota";
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

// Server-side paginated/filtered/sorted reservations list (issue #100). Returns
// exactly one page of rows plus the exact total for pagination, instead of the
// whole table — the previous unbounded fetch shipped ~26 MB (13k rows) to the
// client on every list render and save.
export async function getReservationsPage(params: ReservationListParams) {
  const supabase = await createClient();

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

  let q = supabase
    .from("reservations")
    .select(RESERVATION_SELECT, { count: "exact" });

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
  return { rows: data ?? [], total: count ?? 0 };
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
