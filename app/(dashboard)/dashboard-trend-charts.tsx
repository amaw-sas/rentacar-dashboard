"use client";

import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import type { DailySeriesPoint } from "@/lib/queries/dashboard";

// The theme's --chart-* tokens are all grayscale (chroma 0), so multiple
// franchise lines would be indistinguishable. These distinct, colorblind-
// reasonable hues (blue / amber / green / violet / red) keep each line readable
// in light and dark; the palette cycles if there are more franchises.
const LINE_COLORS = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#dc2626"];

interface FranchiseRef {
  code: string;
  label: string;
}

type Row = Record<string, string | number>;

// Pivots the long (day, franchise) series into one row per day with a column per
// franchise CODE (the unique key; display_name is not constrained unique), the
// shape Recharts multi-line charts expect. Every franchise is seeded to 0 per
// day so a sparse series still renders a point at 0.
function pivot(
  series: DailySeriesPoint[],
  franchises: FranchiseRef[],
  metric: "created_count" | "used_count"
): Row[] {
  const byDay = new Map<string, Row>();
  for (const point of series) {
    let row = byDay.get(point.day);
    if (!row) {
      row = { day: point.day };
      for (const f of franchises) row[f.code] = 0;
      byDay.set(point.day, row);
    }
    row[point.franchise] = point[metric];
  }
  return Array.from(byDay.values()).sort((a, b) =>
    String(a.day).localeCompare(String(b.day))
  );
}

// "YYYY-MM-DD" -> "DD/MM" (no Date parsing, avoids timezone-shift pitfalls).
function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function TrendChart({
  title,
  description,
  data,
  franchises,
}: {
  title: string;
  description: string;
  data: Row[];
  franchises: FranchiseRef[];
}) {
  return (
    <ChartCard title={title} description={description}>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sin datos en este período
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={formatDay} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            {franchises.map((f, i) => (
              <Line
                key={f.code}
                type="monotone"
                dataKey={f.code}
                name={f.label}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function DashboardTrendCharts({
  series,
  franchises,
}: {
  series: DailySeriesPoint[];
  franchises: FranchiseRef[];
}) {
  const created = pivot(series, franchises, "created_count");
  const used = pivot(series, franchises, "used_count");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <TrendChart
        title="Reservas creadas"
        description="Por día y franquicia"
        data={created}
        franchises={franchises}
      />
      <TrendChart
        title="Reservas utilizadas"
        description="Recogidas por día y franquicia"
        data={used}
        franchises={franchises}
      />
    </div>
  );
}
