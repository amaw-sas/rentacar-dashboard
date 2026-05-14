import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

export type { DateRange };

export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function fromLocalIsoDate(iso: string): Date | undefined {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) return undefined;
  const [, y, mo, d] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return undefined;
  }
  return date;
}

export function isWithinDateRange(
  iso: string,
  range: DateRange | undefined,
): boolean {
  if (!range?.from || !range?.to) return true;
  const value = iso.slice(0, 10);
  if (value < toLocalIsoDate(range.from)) return false;
  if (value > toLocalIsoDate(range.to)) return false;
  return true;
}

export function formatRangeLabel(range: DateRange | undefined): string | null {
  if (!range?.from) return null;
  if (!range.to) {
    return format(range.from, "d MMM yyyy", { locale: es });
  }
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  const fromFmt = sameYear ? "d MMM" : "d MMM yyyy";
  const fromStr = format(range.from, fromFmt, { locale: es });
  const toStr = format(range.to, "d MMM yyyy", { locale: es });
  return `${fromStr} – ${toStr}`;
}
