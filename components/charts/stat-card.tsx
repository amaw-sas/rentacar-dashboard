import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive: boolean };
  breakdown?: { label: string; value: number }[];
  /** When set, the whole card becomes a link to this href (e.g. a pre-filtered
   *  reservations list). Adds hover/focus affordance; omit for a static card. */
  href?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  breakdown,
  href,
  className,
}: StatCardProps) {
  const card = (
    <Card
      className={cn(
        "min-w-0",
        href &&
          "h-full transition group-hover/statcard:ring-foreground/25 group-hover/statcard:bg-accent/40",
        className
      )}
    >
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground truncate">
            {title}
          </p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
        {trend && (
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              trend.positive ? "text-green-600" : "text-red-600"
            )}
          >
            {trend.value}
          </p>
        )}
        {breakdown && breakdown.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {breakdown.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between text-xs text-muted-foreground"
              >
                <span className="truncate">{item.label}</span>
                <span className="ml-2 shrink-0 tabular-nums">{item.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group/statcard block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {card}
      </Link>
    );
  }

  return card;
}
