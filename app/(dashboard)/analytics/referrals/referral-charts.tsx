"use client";

import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { StatCard } from "@/components/charts/stat-card";

interface ReferralRow {
  id: string;
  referral_code: string | null;
  selected_category_code: string | null;
  converted_to_reservation: boolean;
  searched_at: string;
}

export function ReferralCharts({ data }: { data: ReferralRow[] }) {
  const referralMap = new Map<
    string,
    { searches: number; selections: number; reservations: number }
  >();
  for (const row of data) {
    const code = row.referral_code ?? "desconocido";
    const entry = referralMap.get(code) ?? {
      searches: 0,
      selections: 0,
      reservations: 0,
    };
    entry.searches++;
    if (row.selected_category_code) entry.selections++;
    if (row.converted_to_reservation) entry.reservations++;
    referralMap.set(code, entry);
  }

  const referralData = Array.from(referralMap.entries())
    .map(([code, stats]) => ({
      code,
      ...stats,
      conversionRate:
        stats.searches > 0
          ? ((stats.reservations / stats.searches) * 100).toFixed(1)
          : "0",
    }))
    .sort((a, b) => b.searches - a.searches);

  const topChart = referralData.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Total referidos activos" value={referralMap.size} />
        <StatCard title="Total búsquedas referidas" value={data.length} />
        <StatCard
          title="Reservas por referidos"
          value={data.filter((r) => r.converted_to_reservation).length}
        />
      </div>

      <ChartCard title="Top referidos por búsquedas">
        {topChart.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos de referidos
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={topChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="code" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="searches"
                name="Búsquedas"
                fill="hsl(var(--chart-1))"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="reservations"
                name="Reservas"
                fill="hsl(var(--chart-3))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Ranking de referidos">
        {referralData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos de referidos
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Código</th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    Búsquedas
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    Selecciones
                  </th>
                  <th className="pb-2 pr-4 font-medium text-right">
                    Reservas
                  </th>
                  <th className="pb-2 font-medium text-right">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {referralData.map((r) => (
                  <tr key={r.code} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{r.code}</td>
                    <td className="py-2 pr-4 text-right">{r.searches}</td>
                    <td className="py-2 pr-4 text-right">{r.selections}</td>
                    <td className="py-2 pr-4 text-right">{r.reservations}</td>
                    <td className="py-2 text-right">{r.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
