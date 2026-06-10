"use client";

import { es } from "date-fns/locale";
import { CalendarIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { type DateRange, formatRangeLabel } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type { DateRange };

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  align?: "start" | "center" | "end";
  className?: string;
  numberOfMonths?: number;
  ariaLabel?: string;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Elegir rango",
  align = "start",
  className,
  numberOfMonths = 1,
  ariaLabel,
}: DateRangePickerProps) {
  const label = formatRangeLabel(value);
  const hasValue = Boolean(value?.from);
  const computedAriaLabel =
    ariaLabel ??
    (label ? `${placeholder}: ${label}` : `${placeholder}, sin selección`);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={computedAriaLabel}
          className={cn(
            "h-9 w-56 justify-start gap-2 font-normal",
            !hasValue && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label ?? placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align={align}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={numberOfMonths}
          locale={es}
          // No `min`: react-day-picker's default (min=0) allows a single-day
          // range (from === to) — required by issue #116. `resetOnSelect`
          // already defers the filter to the second click (the first click on
          // an empty selection yields {from, to: undefined}), so the first
          // click never applies a complete-range filter.
          resetOnSelect
          autoFocus
        />
        {hasValue ? (
          <div className="flex justify-end border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(undefined)}
            >
              <XIcon className="h-3 w-3" />
              Limpiar
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
