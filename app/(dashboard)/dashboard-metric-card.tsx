import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface FranchiseBreakdown {
  code: string;
  short: string; // compact tag, e.g. "ATC"
  full: string; // display_name, surfaced via title tooltip
  value: number;
  color?: string; // matches this franchise's trend-chart line color
}

export interface MetricItem {
  label: string;
  value: number;
  href: string;
  // Per-franchise split of `value` for this period. Optional so the card still
  // renders for metrics without a breakdown.
  breakdown?: FranchiseBreakdown[];
}

// Compact summary card pairing one metric (created / used) with its four period
// totals. Each row links to the matching pre-filtered reservations list, keeping
// the click-through the old per-period StatCards had. When a row carries a
// breakdown, a dense per-franchise line sits under the total so an operator can
// see, at a glance, which franchise drove the count. Sits in the narrow left
// column next to the wider trend chart.
export function DashboardMetricCard({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon?: LucideIcon;
  items: MetricItem[];
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.label} className="py-1">
              <Link
                href={item.href}
                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm text-muted-foreground">
                  {item.label}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {item.value}
                </span>
              </Link>
              {item.breakdown && item.breakdown.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1.5 pb-1 text-xs text-muted-foreground">
                  {item.breakdown.map((b, i) => (
                    <span
                      key={b.code}
                      title={`${b.full}: ${b.value}`}
                      className="whitespace-nowrap"
                    >
                      <span className="font-semibold" style={{ color: b.color }}>
                        {b.short}
                      </span>{" "}
                      <span className="font-medium tabular-nums text-foreground/80">
                        {b.value}
                      </span>
                      {i < item.breakdown!.length - 1 && (
                        <span className="ml-1.5 text-muted-foreground/50">
                          ·
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
