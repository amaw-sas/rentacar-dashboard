"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
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

  // The trend queries run on the server after each URL change and can take a
  // noticeable beat. Wrapping router.replace in a transition keeps isPending
  // true until the new server render streams in, so the clicked control can show
  // a spinner instead of looking frozen. `pendingValue` remembers WHICH preset
  // was clicked so only that button spins.
  const [isPending, startTransition] = useTransition();
  const [pendingValue, setPendingValue] = useState<DashboardPeriod | null>(null);

  const setParams = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const selectPreset = (value: DashboardPeriod) => {
    setPendingValue(value);
    if (value === "custom") {
      // Seed custom with the currently-resolved range so the picker opens populated.
      setParams({ period: "custom", from, to });
    } else {
      setParams({ period: value, from: undefined, to: undefined });
    }
  };

  const onRangeChange = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      setPendingValue("custom");
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
      {PRESETS.map((preset) => {
        const isActive = period === preset.value;
        const isLoading = isPending && pendingValue === preset.value;
        return (
          <Button
            key={preset.value}
            size="sm"
            variant={isActive ? "default" : "outline"}
            aria-pressed={isActive}
            aria-busy={isLoading}
            disabled={isPending}
            onClick={() => selectPreset(preset.value)}
          >
            {isLoading && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            {preset.label}
          </Button>
        );
      })}
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
