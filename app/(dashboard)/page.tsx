import { Suspense } from "react";
import { CalendarCheck, CarFront } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getReservationCounts,
  getUsedCounts,
  getReservationDailySeries,
  getTopReferrals,
  getRecentReservations,
  type PeriodCount,
} from "@/lib/queries/dashboard";
import {
  bogotaTodayYMD,
  bogotaYesterdayYMD,
  bogotaStartOfWeekYMD,
  bogotaStartOfMonthYMD,
  bogotaEndOfMonthYMD,
  resolveDashboardRange,
  type DashboardPeriod,
} from "@/lib/date/bogota";
import { getFranchises } from "@/lib/queries/franchises";
import { franchiseShortLabel } from "@/lib/franchises/short-label";
import { STATUS_LABELS } from "@/lib/schemas/reservation";
import { DashboardPeriodSelector } from "./dashboard-period-selector";
import { FranchiseLineChart } from "./dashboard-trend-charts";
import {
  DashboardMetricCard,
  type MetricItem,
  type FranchiseBreakdown,
} from "./dashboard-metric-card";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  nueva: "outline",
  pendiente: "secondary",
  reservado: "default",
  sin_disponibilidad: "secondary",
  utilizado: "default",
  no_contactado: "secondary",
  baneado: "destructive",
  no_recogido: "destructive",
  pendiente_pago: "secondary",
  pendiente_modificar: "secondary",
  cancelado: "destructive",
  indeterminado: "outline",
  mensualidad: "default",
};

const copFormat = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Trend-chart period comes from the URL (?period & optional from/to). The
  // selector writes these; the server resolves the range so it stays the source
  // of truth. Default: current week.
  const sp = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const periodParam = readParam("period");
  const period: DashboardPeriod =
    periodParam === "month" || periodParam === "custom" ? periodParam : "week";
  const { fromYMD, toYMD } = resolveDashboardRange(
    period,
    readParam("from"),
    readParam("to")
  );

  // Franchises drive the chart series and its labels. Only the count/series
  // queries depend on them, so fetch franchises alongside the independent
  // queries and chain those off the resolved list — keeps everything else parallel.
  const [franchises, topReferrals, recentReservations] = await Promise.all([
    getFranchises(),
    getTopReferrals(5),
    getRecentReservations(5),
  ]);

  const activeFranchises = (franchises ?? []).filter(
    (f) => f.status === "active"
  );
  const activeCodes = activeFranchises.map((f) => f.code);
  const [reservationCounts, usedCounts, dailySeries] = await Promise.all([
    getReservationCounts(activeCodes),
    getUsedCounts(activeCodes),
    getReservationDailySeries(activeCodes, fromYMD, toYMD),
  ]);

  // Civil dates for the pre-filtered reservations-list links. Created metrics
  // filter Creación (created_at); used metrics filter Recogida (pickup_date) with
  // status='utilizado'. Closed-range rows (hoy/ayer) pass both bounds; "since
  // now" rows (semana/mes created) pass only a lower bound.
  const today = bogotaTodayYMD();
  const yesterday = bogotaYesterdayYMD();
  const weekStart = bogotaStartOfWeekYMD();
  const monthStart = bogotaStartOfMonthYMD();
  const monthEnd = bogotaEndOfMonthYMD();
  const reservationsHref = (params: Record<string, string>) =>
    `/reservations?${new URLSearchParams(params).toString()}`;

  const franchiseRefs = activeFranchises.map((f) => ({
    code: f.code,
    label: f.display_name,
  }));

  // Pre-resolve the compact franchise tags once, then split each period's count
  // by franchise in a fixed (display_name-ordered) sequence so the breakdown
  // line is stable across periods. byFranchise is keyed by franchise code and
  // already sums to `total` (getReservationCounts).
  const franchiseTags = franchiseRefs.map((f) => ({
    code: f.code,
    short: franchiseShortLabel(f.label),
    full: f.label,
  }));
  const breakdownOf = (pc: PeriodCount): FranchiseBreakdown[] =>
    franchiseTags.map((t) => ({ ...t, value: pc.byFranchise[t.code] ?? 0 }));

  const createdItems: MetricItem[] = [
    {
      label: "Hoy",
      value: reservationCounts.today.total,
      href: reservationsHref({ created_from: today, created_to: today }),
      breakdown: breakdownOf(reservationCounts.today),
    },
    {
      label: "Ayer",
      value: reservationCounts.yesterday.total,
      href: reservationsHref({ created_from: yesterday, created_to: yesterday }),
      breakdown: breakdownOf(reservationCounts.yesterday),
    },
    {
      label: "Esta semana",
      value: reservationCounts.week.total,
      href: reservationsHref({ created_from: weekStart }),
      breakdown: breakdownOf(reservationCounts.week),
    },
    {
      label: "Este mes",
      value: reservationCounts.month.total,
      href: reservationsHref({ created_from: monthStart }),
      breakdown: breakdownOf(reservationCounts.month),
    },
  ];

  const usedItems: MetricItem[] = [
    {
      label: "Hoy",
      value: usedCounts.today.total,
      href: reservationsHref({
        status: "utilizado",
        pickup_from: today,
        pickup_to: today,
      }),
      breakdown: breakdownOf(usedCounts.today),
    },
    {
      label: "Ayer",
      value: usedCounts.yesterday.total,
      href: reservationsHref({
        status: "utilizado",
        pickup_from: yesterday,
        pickup_to: yesterday,
      }),
      breakdown: breakdownOf(usedCounts.yesterday),
    },
    {
      label: "Esta semana",
      value: usedCounts.week.total,
      href: reservationsHref({
        status: "utilizado",
        pickup_from: weekStart,
        pickup_to: today,
      }),
      breakdown: breakdownOf(usedCounts.week),
    },
    {
      label: "Este mes",
      value: usedCounts.month.total,
      href: reservationsHref({
        status: "utilizado",
        pickup_from: monthStart,
        pickup_to: monthEnd,
      }),
      breakdown: breakdownOf(usedCounts.month),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {/* Per-franchise reservations: a period-summary card paired with a wider
          trend chart, one row per metric (created / used). The period selector
          drives both charts' date range; the cards show fixed periods. */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Reservas por franquicia
          </h2>
          <Suspense fallback={<div className="h-9" />}>
            <DashboardPeriodSelector period={period} from={fromYMD} to={toYMD} />
          </Suspense>
        </div>

        {/* Created */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <DashboardMetricCard
            title="Reservas creadas"
            icon={CalendarCheck}
            items={createdItems}
          />
          <div className="lg:col-span-3">
            <FranchiseLineChart
              title="Reservas creadas"
              description="Por día y franquicia"
              series={dailySeries}
              franchises={franchiseRefs}
              metric="created_count"
            />
          </div>
        </div>

        {/* Used */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <DashboardMetricCard
            title="Reservas utilizadas"
            icon={CarFront}
            items={usedItems}
          />
          <div className="lg:col-span-3">
            <FranchiseLineChart
              title="Reservas utilizadas"
              description="Recogidas por día y franquicia"
              series={dailySeries}
              franchises={franchiseRefs}
              metric="used_count"
            />
          </div>
        </div>
      </div>

      {/* Bottom sections */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top referrals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Referidos del Mes</CardTitle>
          </CardHeader>
          <CardContent>
            {topReferrals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin referidos este mes
              </p>
            ) : (
              <div className="space-y-3">
                {topReferrals.map((ref, i) => (
                  <div
                    key={ref.code}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-muted-foreground w-5 shrink-0">
                        {i + 1}.
                      </span>
                      <span className="text-sm font-medium truncate">
                        {ref.name}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {ref.code}
                      </Badge>
                    </div>
                    <span className="text-sm font-semibold tabular-nums ml-2">
                      {ref.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent reservations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reservas Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentReservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin reservas registradas
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Código</th>
                      <th className="pb-2 font-medium">Cliente</th>
                      <th className="pb-2 font-medium">Estado</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReservations.map((r) => {
                      const rawCustomer = r.customers as
                        | { first_name: string; last_name: string }
                        | { first_name: string; last_name: string }[]
                        | null;
                      const customer = Array.isArray(rawCustomer)
                        ? rawCustomer[0]
                        : rawCustomer;
                      const status = r.status as string;
                      const customerName =
                        r.customer_name_at_booking ??
                        (customer
                          ? `${customer.first_name} ${customer.last_name}`
                          : "—");

                      return (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2">
                            <Link
                              href={`/reservations/${r.id}`}
                              className="text-primary hover:underline font-medium"
                            >
                              {r.reservation_code ?? "—"}
                            </Link>
                          </td>
                          <td className="py-2 truncate max-w-[140px]">
                            {customerName}
                          </td>
                          <td className="py-2">
                            <Badge
                              variant={STATUS_VARIANT[status] ?? "secondary"}
                            >
                              {STATUS_LABELS[
                                status as keyof typeof STATUS_LABELS
                              ] ?? status}
                            </Badge>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {r.total_price != null
                              ? copFormat.format(r.total_price)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
