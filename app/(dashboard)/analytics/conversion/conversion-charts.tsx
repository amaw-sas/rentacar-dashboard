"use client";

import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { StatCard } from "@/components/charts/stat-card";

interface ConversionRow {
  id: string;
  selected_category_code: string | null;
  converted_to_reservation: boolean;
  searched_at: string;
}

export function ConversionCharts({ data }: { data: ConversionRow[] }) {
  const totalSearches = data.length;
  const selectedCategory = data.filter(
    (r) => r.selected_category_code !== null
  ).length;
  const convertedToReservation = data.filter(
    (r) => r.converted_to_reservation
  ).length;

  const selectionRate =
    totalSearches > 0
      ? ((selectedCategory / totalSearches) * 100).toFixed(1)
      : "0";
  const conversionRate =
    totalSearches > 0
      ? ((convertedToReservation / totalSearches) * 100).toFixed(1)
      : "0";
  const selectionToConversion =
    selectedCategory > 0
      ? ((convertedToReservation / selectedCategory) * 100).toFixed(1)
      : "0";

  const funnelData = [
    { step: "Búsquedas", count: totalSearches },
    { step: "Seleccionó categoría", count: selectedCategory },
    { step: "Reservó", count: convertedToReservation },
  ];

  const FUNNEL_COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard title="Total búsquedas" value={totalSearches} />
        <StatCard
          title="Seleccionaron categoría"
          value={`${selectedCategory} (${selectionRate}%)`}
        />
        <StatCard
          title="Reservaron"
          value={`${convertedToReservation} (${conversionRate}%)`}
        />
        <StatCard
          title="Selección → Reserva"
          value={`${selectionToConversion}%`}
        />
      </div>

      <ChartCard
        title="Embudo de conversión"
        description="Búsqueda → Selección de categoría → Reserva"
      >
        {totalSearches === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="step" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Cantidad" radius={[4, 4, 0, 0]}>
                {funnelData.map((_, index) => (
                  <Cell key={index} fill={FUNNEL_COLORS[index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
