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

// Per-franchise line colors, assigned by franchise CODE (not by order) per the
// brand convention: alquilatucarro = blue, alquilame = red, alquicarros =
// orange-amber. Unknown codes fall back to a distinct cycling palette. The
// theme's --chart-* tokens are grayscale, so lines need their own hues.
const FRANCHISE_COLORS: Record<string, string> = {
  alquilatucarro: "#2563eb", // azul
  alquilame: "#dc2626", // rojo
  alquicarros: "#d97706", // amarillo-naranja
};
const FALLBACK_COLORS = ["#7c3aed", "#059669", "#0891b2", "#db2777"];

function colorFor(code: string, index: number): string {
  return FRANCHISE_COLORS[code] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

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

export function FranchiseLineChart({
  title,
  description,
  series,
  franchises,
  metric,
}: {
  title: string;
  description: string;
  series: DailySeriesPoint[];
  franchises: FranchiseRef[];
  metric: "created_count" | "used_count";
}) {
  const data = pivot(series, franchises, metric);

  return (
    <ChartCard title={title} description={description}>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Sin datos en este período
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
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
                stroke={colorFor(f.code, i)}
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
