"use client";

import { useMemo, useState } from "react";
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
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CityPeriodCounts, CityDailyPoint } from "@/lib/queries/analytics";
import {
  rankCities,
  type CityMetric,
  type CityPeriod,
} from "./pivot";
import { cityDailyValues, type CitySparkline } from "./momentum";

interface FranchiseRef {
  code: string;
  label: string;
  short: string;
  color: string;
}

const METRICS: { value: CityMetric; label: string }[] = [
  { value: "used", label: "Utilizadas" },
  { value: "created", label: "Creadas" },
];

const PERIODS: { value: CityPeriod; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "yesterday", label: "Ayer" },
  { value: "week", label: "Esta semana" },
  { value: "last7", label: "Últimos 7 días" },
  { value: "last14", label: "Últimos 14 días" },
  { value: "month", label: "Este mes" },
  { value: "last30", label: "Últimos 30 días" },
];

export function CitiesReport({
  data,
  daily,
  todayYMD,
  franchises,
}: {
  data: CityPeriodCounts[];
  daily: CityDailyPoint[];
  todayYMD: string;
  franchises: FranchiseRef[];
}) {
  const [metric, setMetric] = useState<CityMetric>("used");
  const [period, setPeriod] = useState<CityPeriod>("last7");

  const codes = useMemo(() => franchises.map((f) => f.code), [franchises]);
  const ranking = useMemo(
    () => rankCities(data, codes, metric, period),
    [data, codes, metric, period]
  );
  // Per-city sparkline for the detail table's trend column; follows the metric
  // toggle, independent of the period buttons (always the recent days).
  const sparklines = useMemo(
    () => cityDailyValues(daily, todayYMD, metric),
    [daily, todayYMD, metric]
  );

  // Bars for every city that actually rented in this slice (cities at 0 are kept
  // in the table below but would only add empty bars). Each franchise count
  // becomes a top-level key so Recharts can stack by franchise code.
  const chartData = useMemo(
    () =>
      ranking.rows
        .filter((r) => r.total > 0)
        .map((r) => ({ cityName: r.cityName, ...r.byFranchise })),
    [ranking]
  );

  const metricNoun = metric === "used" ? "utilizadas" : "creadas";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Ciudades que más rentaron
          </h2>
          <p className="text-sm text-muted-foreground">
            Reservas {metricNoun} por ciudad y franquicia
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ToggleGroup
            ariaLabel="Métrica"
            options={METRICS}
            value={metric}
            onChange={setMetric}
          />
          <ToggleGroup
            ariaLabel="Período"
            options={PERIODS}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </div>

      <ChartCard title="Ciudades por reservas">
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos en este período
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 38)}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="cityName"
                width={110}
                tick={{ fontSize: 12 }}
              />
              <Tooltip />
              <Legend />
              {franchises.map((f) => (
                <Bar
                  key={f.code}
                  dataKey={f.code}
                  name={f.label}
                  stackId="a"
                  fill={f.color}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Detalle por ciudad y franquicia">
        {ranking.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos en este período
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Ciudad</th>
                  {franchises.map((f) => (
                    <th
                      key={f.code}
                      title={f.label}
                      className="px-3 py-2 text-right font-semibold"
                      style={{ color: f.color }}
                    >
                      {f.short}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Últ. 5 días
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranking.rows.map((r) => (
                  <tr
                    key={r.cityId ?? "__none__"}
                    className="border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-3 py-2 text-left">{r.cityName}</td>
                    {franchises.map((f) => (
                      <td
                        key={f.code}
                        className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                      >
                        {r.byFranchise[f.code] || 0}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {r.total}
                    </td>
                    <td className="px-3 py-2">
                      <SparkCell spark={sparklines.get(r.cityId ?? "__none__")} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr>
                  <td className="px-3 py-2 text-left">Total</td>
                  {franchises.map((f) => (
                    <td
                      key={f.code}
                      className="px-3 py-2 text-right tabular-nums"
                    >
                      {ranking.franchiseTotals[f.code] ?? 0}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {ranking.grandTotal}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

const TREND_COLOR = {
  up: "#059669",
  down: "#dc2626",
  flat: "#9ca3af",
} as const;

// Lightweight inline-SVG sparkline — avoids mounting a Recharts container per
// row (one detail table can have ~20 cities). 7 points, normalized to its own
// min/max so the shape is visible even for small counts.
function Sparkline({ spark }: { spark: CitySparkline }) {
  const width = 64;
  const height = 22;
  const pad = 2;
  const { values, trend } = spark;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + (height - 2 * pad) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={TREND_COLOR[trend]}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparkCell({ spark }: { spark: CitySparkline | undefined }) {
  if (!spark) {
    return <span className="block text-right text-muted-foreground">—</span>;
  }
  const Icon =
    spark.trend === "up" ? TrendingUp : spark.trend === "down" ? TrendingDown : Minus;
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Sparkline spark={spark} />
      <Icon
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: TREND_COLOR[spark.trend] }}
        aria-hidden
      />
    </div>
  );
}

function ToggleGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <Button
          key={o.value}
          size="sm"
          variant={value === o.value ? "default" : "outline"}
          aria-pressed={value === o.value}
          className={cn(value === o.value && "pointer-events-none")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
