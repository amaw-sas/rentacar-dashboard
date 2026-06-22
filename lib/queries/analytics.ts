import { createClient } from "@/lib/supabase/server";
import { bogotaDayStartISO, bogotaDayEndISO } from "@/lib/date/bogota";

export interface AnalyticsFilters {
  // `from`/`to` are civil dates "YYYY-MM-DD" in Colombia time (America/Bogota),
  // matching the Reservations "Creado" filter contract (#115) — NOT raw ISO
  // instants. They are anchored to the Colombia day boundary before comparing
  // against the UTC `timestamptz` columns, so a row stamped 22:00 Colombia (the
  // next UTC day) still falls inside the intended Colombia day. Issue #126.
  from?: string;
  to?: string;
  franchise?: string;
  referral_code?: string;
}

// Anchors a civil-date range to Colombia day boundaries (#126). `from` becomes
// the inclusive 00:00-Colombia lower bound, `to` the inclusive 23:59:59.999
// upper bound, both expressed as UTC instants for comparison against a
// `timestamptz` column. Shares the helpers with reservations (#115) / dashboard
// (#114). Generic over the PostgREST builder so it stays type-safe without `any`.
function applyDateRange<
  T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }
>(query: T, column: string, filters?: AnalyticsFilters): T {
  if (filters?.from) query = query.gte(column, bogotaDayStartISO(filters.from));
  if (filters?.to) query = query.lte(column, bogotaDayEndISO(filters.to));
  return query;
}

export async function getDemandStats(filters?: AnalyticsFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("search_logs")
    .select(
      "id, franchise, pickup_location_code, return_location_code, pickup_date, selected_category_code, available_categories, total_results, searched_at"
    )
    .order("searched_at", { ascending: false });

  query = applyDateRange(query, "searched_at", filters);
  if (filters?.franchise) {
    query = query.eq("franchise", filters.franchise);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getConversionStats(filters?: AnalyticsFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("search_logs")
    .select(
      "id, selected_category_code, converted_to_reservation, searched_at"
    )
    .order("searched_at", { ascending: false });

  query = applyDateRange(query, "searched_at", filters);
  if (filters?.franchise) {
    query = query.eq("franchise", filters.franchise);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getReferralPerformance(filters?: AnalyticsFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("search_logs")
    .select(
      "id, referral_code, selected_category_code, converted_to_reservation, searched_at"
    )
    .not("referral_code", "is", null)
    .order("searched_at", { ascending: false });

  query = applyDateRange(query, "searched_at", filters);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getAttributionBreakdown(): Promise<
  { attribution_channel: string | null; count: number }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attribution_breakdown");
  if (error) throw error;
  return (data ?? []) as { attribution_channel: string | null; count: number }[];
}

// One row per (city, franchise) with the eight period×metric counts. city_id /
// city_name are null for the "Sin ciudad" bucket (locations without a city).
// Backed by the cities_rental_period_counts RPC (migration 066), which mirrors
// the dashboard's period + Colombia-time semantics so the numbers reconcile.
export interface CityPeriodCounts {
  city_id: string | null;
  city_name: string | null;
  franchise: string;
  created_today: number;
  created_yesterday: number;
  created_week: number;
  created_month: number;
  used_today: number;
  used_yesterday: number;
  used_week: number;
  used_month: number;
}

export async function getCitiesRentalPeriodCounts(
  activeCodes: string[]
): Promise<CityPeriodCounts[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cities_rental_period_counts", {
    p_franchises: activeCodes,
  });
  if (error) throw error;
  return (data ?? []) as CityPeriodCounts[];
}

const COMMISSION_REVENUE_SELECT = `
  id, amount, payment_status, created_at,
  reservations(id, total_price, franchise)
`;

export async function getRevenueStats(filters?: AnalyticsFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("commissions")
    .select(COMMISSION_REVENUE_SELECT)
    .order("created_at", { ascending: false });

  query = applyDateRange(query, "created_at", filters);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
