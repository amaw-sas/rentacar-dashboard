import { createClient } from "@/lib/supabase/server";
import {
  bogotaStartOfDayISO,
  bogotaStartOfWeekISO,
  bogotaStartOfMonthISO,
  bogotaDayStartISO,
  bogotaDayEndISO,
  bogotaYesterdayYMD,
  bogotaStartOfMonthYMD,
  bogotaEndOfMonthYMD,
} from "@/lib/date/bogota";

export interface PeriodCount {
  total: number;
  byFranchise: Record<string, number>; // key = franchise code
}

export interface ReservationCounts {
  today: PeriodCount;
  yesterday: PeriodCount;
  week: PeriodCount;
  month: PeriodCount;
}

// Counts reservations created in each period (today / yesterday / this week /
// this month), with a per-franchise breakdown. Period cutoffs are anchored to
// Colombia time (see lib/date/bogota). Only the given active franchise codes are
// counted, so `total` always equals the sum of `byFranchise`.
//
// Uses head/count queries (one per franchise per period) instead of fetching
// rows: counting happens in Postgres, so it never hits PostgREST's max_rows cap
// — a period with >1000 reservations still counts correctly (cf. issue #75).
export async function getReservationCounts(
  activeCodes: string[]
): Promise<ReservationCounts> {
  const supabase = await createClient();

  // `untilISO` bounds closed ranges (yesterday); open-ended periods (today/week/
  // month = "since X until now") pass only `sinceISO`.
  const countCreatedRange = async (
    sinceISO: string,
    untilISO?: string
  ): Promise<PeriodCount> => {
    const entries = await Promise.all(
      activeCodes.map(async (code) => {
        let query = supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sinceISO)
          .eq("franchise", code);
        if (untilISO) query = query.lte("created_at", untilISO);
        const { count, error } = await query;
        if (error) throw error;
        return [code, count ?? 0] as const;
      })
    );

    const byFranchise: Record<string, number> = Object.fromEntries(entries);
    const total = entries.reduce((acc, [, n]) => acc + n, 0);
    return { total, byFranchise };
  };

  const yesterdayYMD = bogotaYesterdayYMD();

  const [today, yesterday, week, month] = await Promise.all([
    countCreatedRange(bogotaStartOfDayISO()),
    countCreatedRange(
      bogotaDayStartISO(yesterdayYMD),
      bogotaDayEndISO(yesterdayYMD)
    ),
    countCreatedRange(bogotaStartOfWeekISO()),
    countCreatedRange(bogotaStartOfMonthISO()),
  ]);

  return { today, yesterday, week, month };
}

// Counts reservations USED this month, keyed by pickup_date (the day the car is
// picked up) AND status='utilizado' — NOT created_at. A reservation created in a
// prior month but picked up this month counts here: this is the "cars actually
// used this month" metric, deliberately distinct from getReservationCounts,
// which is creation-based. Bounds are civil "YYYY-MM-DD" dates because
// pickup_date is a `date` column (mirrors the reservations list Recogida filter,
// lib/queries/reservations.ts). Per-franchise breakdown like the period counts.
export async function getUsedThisMonth(
  activeCodes: string[]
): Promise<PeriodCount> {
  const supabase = await createClient();
  const from = bogotaStartOfMonthYMD();
  const to = bogotaEndOfMonthYMD();

  const entries = await Promise.all(
    activeCodes.map(async (code) => {
      const { count, error } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "utilizado")
        .gte("pickup_date", from)
        .lte("pickup_date", to)
        .eq("franchise", code);
      if (error) throw error;
      return [code, count ?? 0] as const;
    })
  );

  const byFranchise: Record<string, number> = Object.fromEntries(entries);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  return { total, byFranchise };
}

// One row per (day, franchise) over [fromYMD, toYMD], with both the created and
// used counts — the input to the dashboard trend charts. Aggregation happens in
// Postgres via the reservation_daily_series RPC (migration 061): created counts
// bucket by created_at in Bogota time (so they reconcile with getReservationCounts)
// and used counts by pickup_date + status='utilizado' (like getUsedThisMonth).
// The RPC returns a full day×franchise grid (zeros included), so a missing
// (day, franchise) still arrives as 0 and the line plots a point, not a gap.
export interface DailySeriesPoint {
  day: string; // "YYYY-MM-DD" Bogota civil date
  franchise: string; // franchise code
  created_count: number;
  used_count: number;
}

export async function getReservationDailySeries(
  activeCodes: string[],
  fromYMD: string,
  toYMD: string
): Promise<DailySeriesPoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reservation_daily_series", {
    p_from: fromYMD,
    p_to: toYMD,
    p_franchises: activeCodes,
  });
  if (error) throw error;
  return (data ?? []) as DailySeriesPoint[];
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
  const monthStart = bogotaStartOfMonthISO();

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
      "id, reservation_code, status, total_price, pickup_date, created_at, customer_name_at_booking, customers(first_name, last_name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
