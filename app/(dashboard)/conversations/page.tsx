import {
  getConversationsPage,
  getConversationMetrics,
  getDetectedCities,
} from "@/lib/queries/chat-conversations";
import { parseListParams } from "@/lib/chat/list-params";
import { ConversationsTable } from "./conversations-table";
import { ConversationMetricsCards } from "./conversation-metrics";
import type { ConversationRow } from "./columns";

function toSearchParams(
  sp: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value[0] !== undefined) out.set(key, value[0]);
    } else {
      out.set(key, value);
    }
  }
  return out;
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseListParams(toSearchParams(await searchParams));

  const [page, metrics, cities] = await Promise.all([
    getConversationsPage(params),
    getConversationMetrics(params),
    getDetectedCities(),
  ]);

  const pageCount = Math.max(1, Math.ceil(page.total / params.pageSize));
  const cityOptions = cities.map((c) => ({ value: c, label: c }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conversaciones</h1>
        <p className="text-sm text-muted-foreground">
          Revisa las conversaciones del chat IA: lee los hilos, marca cuáles
          salieron bien o mal y detecta qué mejorar.
        </p>
      </div>

      <ConversationMetricsCards metrics={metrics} />

      <ConversationsTable
        data={page.rows as ConversationRow[]}
        total={page.total}
        pageCount={pageCount}
        cities={cityOptions}
      />
    </div>
  );
}
