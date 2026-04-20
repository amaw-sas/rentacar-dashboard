"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

const formatter = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 0,
});

function format(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return formatter.format(Math.trunc(value));
}

function parseDigits(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

type InputProps = React.ComponentProps<typeof Input>;

export interface MoneyInputProps
  extends Omit<InputProps, "value" | "onChange" | "type" | "inputMode"> {
  value?: number | null;
  onChange?: (value: number) => void;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput({ value, onChange, onBlur, ...rest }, ref) {
    const [display, setDisplay] = React.useState<string>(() => format(value));

    React.useEffect(() => {
      setDisplay((prev) => {
        const currentParsed = parseDigits(prev);
        if ((value ?? 0) === currentParsed) return prev;
        return format(value);
      });
    }, [value]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const parsed = parseDigits(event.target.value);
          setDisplay(format(parsed));
          onChange?.(parsed);
        }}
        onBlur={onBlur}
      />
    );
  },
);
