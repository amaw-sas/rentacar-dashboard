"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { StatCard } from "@/components/charts/stat-card";

interface SearchLog {
  id: string;
  franchise: string;
  pickup_location_code: string;
  return_location_code: string;
  pickup_date: string;
  selected_category_code: string | null;
  available_categories: unknown;
  total_results: number;
  searched_at: string;
}

export function DemandCharts({ data }: { data: SearchLog[] }) {
  // Aggregate by category
  const categoryMap = new Map<string, number>();
  for (const row of data) {
    if (row.selected_category_code) {
      categoryMap.set(
        row.selected_category_code,
        (categoryMap.get(row.selected_category_code) ?? 0) + 1
      );
    }
  }
  const categoryData = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // Aggregate by date
  const dateMap = new Map<string, number>();
  for (const row of data) {
    const date = row.searched_at.slice(0, 10);
    dateMap.set(date, (dateMap.get(date) ?? 0) + 1);
  }
  const timeData = Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Aggregate by location
  const locationMap = new Map<string, number>();
  for (const row of data) {
    locationMap.set(
      row.pickup_location_code,
      (locationMap.get(row.pickup_location_code) ?? 0) + 1
    );
  }
  const locationData = Array.from(locationMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Total búsquedas" value={data.length} />
        <StatCard
          title="Categorías buscadas"
          value={categoryMap.size}
        />
        <StatCard
          title="Ubicaciones activas"
          value={locationMap.size}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Búsquedas por categoría">
          {categoryData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin datos de categorías seleccionadas
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="Búsquedas" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Búsquedas en el tiempo">
          {timeData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin datos
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Búsquedas"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Top ubicaciones de recogida">
        {locationData.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={locationData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="location" type="category" width={120} />
              <Tooltip />
              <Bar dataKey="count" name="Búsquedas" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
