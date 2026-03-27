"use client";

import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { StatCard } from "@/components/charts/stat-card";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
});

interface CommissionRow {
  id: string;
  amount: number;
  payment_status: string;
  created_at: string;
  reservations: { id: string; total_price: number; franchise: string }[] | null;
}

export function RevenueCharts({ data }: { data: CommissionRow[] }) {
  const totalPending = data
    .filter((r) => r.payment_status === "pending")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalInvoiced = data
    .filter((r) => r.payment_status === "invoiced")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalPaid = data
    .filter((r) => r.payment_status === "paid")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);

  // By month
  const monthMap = new Map<string, number>();
  for (const row of data) {
    const month = row.created_at.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + (row.amount ?? 0));
  }
  const monthData = Array.from(monthMap.entries())
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // By franchise
  const franchiseMap = new Map<string, number>();
  for (const row of data) {
    const franchise = row.reservations?.[0]?.franchise ?? "Sin franquicia";
    franchiseMap.set(
      franchise,
      (franchiseMap.get(franchise) ?? 0) + (row.amount ?? 0)
    );
  }
  const franchiseData = Array.from(franchiseMap.entries())
    .map(([franchise, total]) => ({ franchise, total }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Pendiente" value={COP.format(totalPending)} />
        <StatCard title="Facturado" value={COP.format(totalInvoiced)} />
        <StatCard title="Pagado" value={COP.format(totalPaid)} />
      </div>

      <ChartCard title="Comisiones por mes">
        {monthData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos de comisiones
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis
                tickFormatter={(v: number) => COP.format(v)}
                width={100}
              />
              <Tooltip
                formatter={(value) => COP.format(Number(value))}
              />
              <Bar
                dataKey="total"
                name="Comisiones"
                fill="hsl(var(--chart-1))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Revenue por franquicia">
        {franchiseData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={franchiseData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                tickFormatter={(v: number) => COP.format(v)}
              />
              <YAxis
                dataKey="franchise"
                type="category"
                width={120}
              />
              <Tooltip
                formatter={(value) => COP.format(Number(value))}
              />
              <Bar
                dataKey="total"
                name="Comisiones"
                fill="hsl(var(--chart-2))"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
