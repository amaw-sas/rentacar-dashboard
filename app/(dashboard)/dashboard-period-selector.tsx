"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { toLocalIsoDate, fromLocalIsoDate } from "@/lib/date-range";
import type { DashboardPeriod } from "@/lib/date/bogota";

const PRESETS: { value: DashboardPeriod; label: string }[] = [
  { value: "week", label: "Semana actual" },
  { value: "month", label: "Mes actual" },
  { value: "custom", label: "Personalizado" },
];

// Drives the trend-chart range via the URL (?period=week|month|custom plus
// &from&to for custom). The server page reads these params and re-resolves the
// range with resolveDashboardRange, so the source of truth stays server-side.
export function DashboardPeriodSelector({
  period,
  from,
  to,
}: {
  period: DashboardPeriod;
  from: string; // resolved range start "YYYY-MM-DD"
  to: string; // resolved range end "YYYY-MM-DD"
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const selectPreset = (value: DashboardPeriod) => {
    if (value === "custom") {
      // Seed custom with the currently-resolved range so the picker opens populated.
      setParams({ period: "custom", from, to });
    } else {
      setParams({ period: value, from: undefined, to: undefined });
    }
  };

  const onRangeChange = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      setParams({
        period: "custom",
        from: toLocalIsoDate(range.from),
        to: toLocalIsoDate(range.to),
      });
    }
  };

  const rangeValue: DateRange | undefined =
    period === "custom"
      ? { from: fromLocalIsoDate(from), to: fromLocalIsoDate(to) }
      : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((preset) => (
        <Button
          key={preset.value}
          size="sm"
          variant={period === preset.value ? "default" : "outline"}
          aria-pressed={period === preset.value}
          onClick={() => selectPreset(preset.value)}
        >
          {preset.label}
        </Button>
      ))}
      {period === "custom" && (
        <DateRangePicker
          value={rangeValue}
          onChange={onRangeChange}
          ariaLabel="Rango personalizado del dashboard"
        />
      )}
    </div>
  );
}
