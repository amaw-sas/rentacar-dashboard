import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface MetricItem {
  label: string;
  value: number;
  href: string;
}

// Compact summary card pairing one metric (created / used) with its four period
// totals. Each row links to the matching pre-filtered reservations list, keeping
// the click-through the old per-period StatCards had. Sits in the narrow left
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
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm text-muted-foreground">
                  {item.label}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {item.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
