"use client";

import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { StatCard } from "@/components/charts/stat-card";
import { channelMeta } from "@/lib/attribution/channel-meta";
import { aggregateChannels } from "@/lib/attribution/aggregate-channels";

export function AttributionCharts({
  data,
}: {
  data: { attribution_channel: string | null }[];
}) {
  const { total, stats } = aggregateChannels(data);

  // "Canales activos" counts real channels (excludes the Desconocido/null bucket).
  const activeChannels = stats.filter((s) => s.channel !== null).length;

  const chartData = stats.map((s) => ({
    label: s.label,
    count: s.count,
    fill: channelMeta(s.channel).chartColor,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Total reservas" value={total} />
        <StatCard title="Canales activos" value={activeChannels} />
      </div>

      <ChartCard title="Reservas por canal de origen">
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos de origen
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Reservas" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.label} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Desglose por canal">
        {stats.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos de origen
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Canal</th>
                  <th className="pb-2 pr-4 font-medium text-right">Reservas</th>
                  <th className="pb-2 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.channel ?? "__unknown__"}
                    className="border-b last:border-0"
                  >
                    <td className="py-2 pr-4 font-medium">{s.label}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {s.count}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {s.pct.toFixed(1)}%
                    </td>
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
