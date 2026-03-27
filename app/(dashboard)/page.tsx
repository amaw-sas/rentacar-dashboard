import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
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
  getCommissionSummary,
  getTopReferrals,
  getRecentReservations,
} from "@/lib/queries/dashboard";
import { STATUS_LABELS } from "@/lib/schemas/reservation";

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

export default async function DashboardPage() {
  const [reservationCounts, commissionSummary, topReferrals, recentReservations] =
    await Promise.all([
      getReservationCounts(),
      getCommissionSummary(),
      getTopReferrals(5),
      getRecentReservations(5),
    ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Reservas hoy"
          value={reservationCounts.today}
          icon={CalendarCheck}
          description="Creadas hoy"
        />
        <StatCard
          title="Reservas esta semana"
          value={reservationCounts.week}
          icon={CalendarDays}
          description="Desde el lunes"
        />
        <StatCard
          title="Reservas este mes"
          value={reservationCounts.month}
          icon={CalendarRange}
          description="Mes en curso"
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
                            {customer
                              ? `${customer.first_name} ${customer.last_name}`
                              : "—"}
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
