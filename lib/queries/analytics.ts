import { createClient } from "@/lib/supabase/server";

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  franchise?: string;
  referral_code?: string;
}

export async function getDemandStats(filters?: AnalyticsFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("search_logs")
    .select(
      "id, franchise, pickup_location_code, return_location_code, pickup_date, selected_category_code, available_categories, total_results, searched_at"
    )
    .order("searched_at", { ascending: false });

  if (filters?.from) {
    query = query.gte("searched_at", filters.from);
  }
  if (filters?.to) {
    query = query.lte("searched_at", filters.to);
  }
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

  if (filters?.from) {
    query = query.gte("searched_at", filters.from);
  }
  if (filters?.to) {
    query = query.lte("searched_at", filters.to);
  }
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

  if (filters?.from) {
    query = query.gte("searched_at", filters.from);
  }
  if (filters?.to) {
    query = query.lte("searched_at", filters.to);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
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

  if (filters?.from) {
    query = query.gte("created_at", filters.from);
  }
  if (filters?.to) {
    query = query.lte("created_at", filters.to);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getDashboardStats() {
  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay()
  ).toISOString();
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();

  const [
    todayReservations,
    weekReservations,
    monthReservations,
    pendingCommissions,
    invoicedCommissions,
    paidCommissions,
    topReferrals,
  ] = await Promise.all([
    supabase
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("converted_to_reservation", true)
      .gte("searched_at", todayStart),
    supabase
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("converted_to_reservation", true)
      .gte("searched_at", weekStart),
    supabase
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("converted_to_reservation", true)
      .gte("searched_at", monthStart),
    supabase
      .from("commissions")
      .select("amount")
      .eq("payment_status", "pending"),
    supabase
      .from("commissions")
      .select("amount")
      .eq("payment_status", "invoiced"),
    supabase
      .from("commissions")
      .select("amount")
      .eq("payment_status", "paid"),
    supabase
      .from("search_logs")
      .select("referral_code, converted_to_reservation")
      .not("referral_code", "is", null)
      .gte("searched_at", monthStart),
  ]);

  const sumAmounts = (rows: { amount: number }[] | null) =>
    (rows ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0);

  const referralMap = new Map<
    string,
    { searches: number; reservations: number }
  >();
  for (const row of topReferrals.data ?? []) {
    const code = row.referral_code!;
    const entry = referralMap.get(code) ?? { searches: 0, reservations: 0 };
    entry.searches++;
    if (row.converted_to_reservation) entry.reservations++;
    referralMap.set(code, entry);
  }

  const topReferralsList = Array.from(referralMap.entries())
    .map(([code, stats]) => ({ code, ...stats }))
    .sort((a, b) => b.reservations - a.reservations)
    .slice(0, 5);

  return {
    reservations: {
      today: todayReservations.count ?? 0,
      week: weekReservations.count ?? 0,
      month: monthReservations.count ?? 0,
    },
    commissions: {
      pending: sumAmounts(pendingCommissions.data as { amount: number }[] | null),
      invoiced: sumAmounts(invoicedCommissions.data as { amount: number }[] | null),
      paid: sumAmounts(paidCommissions.data as { amount: number }[] | null),
    },
    topReferrals: topReferralsList,
  };
}
