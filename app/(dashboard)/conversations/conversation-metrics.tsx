import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConversationMetrics } from "@/lib/queries/chat-conversations";

// Header KPIs for the conversations list. Rates are over the same filtered set as
// the table (the RPC takes the same structural filters). Percentages guard
// against a zero denominator so an empty filter shows "0%", not "NaN%".
function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}

export function ConversationMetricsCards({
  metrics,
}: {
  metrics: ConversationMetrics;
}) {
  const { total, quotedCount, handoffCount, avgMessages } = metrics;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Metric label="Conversaciones" value={String(total)} />
      <Metric
        label="Llegaron a cotizar"
        value={`${pct(quotedCount, total)} · ${quotedCount}`}
      />
      <Metric
        label="Pidieron handoff"
        value={`${pct(handoffCount, total)} · ${handoffCount}`}
      />
      <Metric label="Mensajes (prom.)" value={avgMessages.toFixed(1)} />
    </div>
  );
}
