import { createClient } from "@/lib/supabase/server";
import { startOfDay, startOfWeek, startOfMonth } from "date-fns";

export async function getReservationCounts() {
  const supabase = await createClient();
  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString();
  const monthStart = startOfMonth(now).toISOString();

  const [todayResult, weekResult, monthResult] = await Promise.all([
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekStart),
    supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart),
  ]);

  return {
    today: todayResult.count ?? 0,
    week: weekResult.count ?? 0,
    month: monthResult.count ?? 0,
  };
}

export async function getCommissionSummary() {
  const supabase = await createClient();

  const [pendingResult, invoicedResult, paidResult] = await Promise.all([
    supabase
      .from("commissions")
      .select("commission_amount")
      .eq("payment_status", "pending"),
    supabase
      .from("commissions")
      .select("commission_amount")
      .eq("payment_status", "invoiced"),
    supabase
      .from("commissions")
      .select("commission_amount")
      .eq("payment_status", "paid"),
  ]);

  const sum = (rows: { commission_amount: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + (r.commission_amount ?? 0), 0);

  return {
    pending: sum(pendingResult.data),
    invoiced: sum(invoicedResult.data),
    paid: sum(paidResult.data),
  };
}

export async function getTopReferrals(limit = 5) {
  const supabase = await createClient();
  const monthStart = startOfMonth(new Date()).toISOString();

  const { data, error } = await supabase
    .from("reservations")
    .select("referral_id, referrals(name, code)")
    .gte("created_at", monthStart)
    .not("referral_id", "is", null);

  if (error) throw error;

  const counts = new Map<
    string,
    { name: string; code: string; count: number }
  >();

  for (const row of data ?? []) {
    const id = row.referral_id as string;
    const rawReferral = row.referrals as
      | { name: string; code: string }
      | { name: string; code: string }[]
      | null;
    const referral = Array.isArray(rawReferral) ? rawReferral[0] : rawReferral;
    if (!referral) continue;

    const existing = counts.get(id);
    if (existing) {
      existing.count++;
    } else {
      counts.set(id, { name: referral.name, code: referral.code, count: 1 });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getRecentReservations(limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, reservation_code, status, total_price, pickup_date, created_at, customers(first_name, last_name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
