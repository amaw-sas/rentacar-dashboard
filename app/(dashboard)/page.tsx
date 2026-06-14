import { Suspense } from "react";
import {
  CalendarCheck,
  CalendarMinus,
  CalendarDays,
  CalendarRange,
  CarFront,
  Clock,
  FileText,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { StatCard } from "@/components/charts/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getReservationCounts,
  getUsedThisMonth,
  getReservationDailySeries,
  getCommissionSummary,
  getTopReferrals,
  getRecentReservations,
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
import { STATUS_LABELS } from "@/lib/schemas/reservation";
import { DashboardPeriodSelector } from "./dashboard-period-selector";
import { DashboardTrendCharts } from "./dashboard-trend-charts";

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
  const [franchises, commissionSummary, topReferrals, recentReservations] =
    await Promise.all([
      getFranchises(),
      getCommissionSummary(),
      getTopReferrals(5),
      getRecentReservations(5),
    ]);

  const activeFranchises = (franchises ?? []).filter(
    (f) => f.status === "active"
  );
  const activeCodes = activeFranchises.map((f) => f.code);
  const [reservationCounts, usedThisMonth, dailySeries] = await Promise.all([
    getReservationCounts(activeCodes),
    getUsedThisMonth(activeCodes),
    getReservationDailySeries(activeCodes, fromYMD, toYMD),
  ]);

  // Civil dates for the pre-filtered reservations-list links. Closed-range cards
  // (hoy/ayer) pass both bounds; "since now" cards (semana/mes) pass only a lower
  // bound. Utilizadas filters by Recogida (pickup_date), matching its count.
  const today = bogotaTodayYMD();
  const yesterday = bogotaYesterdayYMD();
  const weekStart = bogotaStartOfWeekYMD();
  const monthStart = bogotaStartOfMonthYMD();
  const monthEnd = bogotaEndOfMonthYMD();
  const reservationsHref = (params: Record<string, string>) =>
    `/reservations?${new URLSearchParams(params).toString()}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Reservas hoy"
          value={reservationCounts.today.total}
          icon={CalendarCheck}
          description="Creadas hoy"
          href={reservationsHref({ created_from: today, created_to: today })}
        />
        <StatCard
          title="Reservas ayer"
          value={reservationCounts.yesterday.total}
          icon={CalendarMinus}
          description="Creadas ayer"
          href={reservationsHref({
            created_from: yesterday,
            created_to: yesterday,
          })}
        />
        <StatCard
          title="Reservas esta semana"
          value={reservationCounts.week.total}
          icon={CalendarDays}
          description="Desde el lunes"
          href={reservationsHref({ created_from: weekStart })}
        />
        <StatCard
          title="Reservas este mes"
          value={reservationCounts.month.total}
          icon={CalendarRange}
          description="Mes en curso"
          href={reservationsHref({ created_from: monthStart })}
        />
        <StatCard
          title="Utilizadas este mes"
          value={usedThisMonth.total}
          icon={CarFront}
          description="Recogidas este mes"
          href={reservationsHref({
            status: "utilizado",
            pickup_from: monthStart,
            pickup_to: monthEnd,
          })}
        />
        <StatCard
          title="Comisiones pendientes"
          value={copFormat.format(commissionSummary.pending)}
          icon={Clock}
          description="Por cobrar"
        />
        <StatCard
          title="Comisiones facturadas"
          value={copFormat.format(commissionSummary.invoiced)}
          icon={FileText}
          description="Factura emitida"
        />
        <StatCard
          title="Comisiones pagadas"
          value={copFormat.format(commissionSummary.paid)}
          icon={Wallet}
          description="Cobradas"
        />
      </div>

      {/* Trend charts: per-franchise created & used over the selected period */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Tendencia por franquicia
          </h2>
          <Suspense fallback={<div className="h-9" />}>
            <DashboardPeriodSelector period={period} from={fromYMD} to={toYMD} />
          </Suspense>
        </div>
        <DashboardTrendCharts
          series={dailySeries}
          franchises={activeFranchises.map((f) => ({
            code: f.code,
            label: f.display_name,
          }))}
        />
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
