import { createClient } from "@/lib/supabase/server";
import { bogotaDayStartISO, bogotaDayEndISO } from "@/lib/date/bogota";
import {
  UNREVIEWED,
  type ChatConversationListParams,
} from "@/lib/chat/list-params";

// Reads for the conversations review page (Chat Fase 2 · Incremento 1). Uses the
// authenticated server client so RLS applies (064 grants authenticated SELECT on
// both chat tables). Mirrors lib/queries/reservations.ts.

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  parts: unknown;
  created_at: string;
}

export interface ConversationRow {
  id: string;
  brand: string;
  city_detected: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  review_label: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // PostgREST embedded aggregate: chat_messages(count) → [{ count }].
  chat_messages: { count: number }[];
}

export interface ConversationMetrics {
  total: number;
  handoffCount: number;
  quotedCount: number;
  avgMessages: number;
}

// Server-side paginated/filtered conversations list. Returns one page of rows
// plus the total for pagination. The embedded chat_messages(count) gives the
// per-row message count in the same round-trip (no N+1).
export async function getConversationsPage(params: ChatConversationListParams) {
  const supabase = await createClient();

  let q = supabase
    .from("chat_conversations")
    .select("*, chat_messages(count)", { count: "exact" });

  if (params.brand) q = q.eq("brand", params.brand);
  if (params.status) q = q.eq("status", params.status);
  if (params.city) q = q.eq("city_detected", params.city);
  // review filter: the UNREVIEWED sentinel means review_label IS NULL; a concrete
  // label is an exact match. Distinct ops because .eq(col, null) ≠ IS NULL.
  if (params.reviewLabel === UNREVIEWED) {
    q = q.is("review_label", null);
  } else if (params.reviewLabel) {
    q = q.eq("review_label", params.reviewLabel);
  }
  // created_at is timestamptz; the URL stores a Colombia civil date. Anchor the
  // bounds to America/Bogota so the filter aligns with the "Creada" column.
  if (params.createdFrom)
    q = q.gte("created_at", bogotaDayStartISO(params.createdFrom));
  if (params.createdTo)
    q = q.lte("created_at", bogotaDayEndISO(params.createdTo));

  q = q
    .order(params.sort.column, { ascending: params.sort.ascending })
    .order("id", { ascending: true });

  const from = (params.page - 1) * params.pageSize;
  q = q.range(from, from + params.pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: (data ?? []) as unknown as ConversationRow[],
    total: count ?? 0,
  };
}

// One conversation + its full message thread, ordered oldest-first for replay.
export async function getConversation(id: string) {
  const supabase = await createClient();

  const { data: conversation, error: convErr } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("id", id)
    .single();
  if (convErr) throw convErr;

  const { data: messages, error: msgErr } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (msgErr) throw msgErr;

  return {
    conversation: conversation as unknown as ConversationRow,
    messages: (messages ?? []) as unknown as ConversationMessage[],
  };
}

// Header KPIs via the 069 RPC. Fails open to zeros so a missing migration or a
// stats hiccup never breaks the page (mirrors reservationsRowEstimate's stance).
export async function getConversationMetrics(
  params: ChatConversationListParams,
): Promise<ConversationMetrics> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_conversation_metrics", {
    p_brand: params.brand,
    p_status: params.status,
    p_city: params.city,
    p_created_from: params.createdFrom
      ? bogotaDayStartISO(params.createdFrom)
      : null,
    p_created_to: params.createdTo ? bogotaDayEndISO(params.createdTo) : null,
  });

  if (error) {
    console.warn("chat_conversation_metrics failed:", error.message);
    return { total: 0, handoffCount: 0, quotedCount: 0, avgMessages: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    total: Number(row?.total ?? 0),
    handoffCount: Number(row?.handoff_count ?? 0),
    quotedCount: Number(row?.quoted_count ?? 0),
    avgMessages: Number(row?.avg_messages ?? 0),
  };
}

// Distinct detected cities present in the data, for the city filter dropdown.
// Volume is low (V1 preview), so a dedupe in JS is fine; bound the scan anyway.
export async function getDetectedCities(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_conversations")
    .select("city_detected")
    .not("city_detected", "is", null)
    .limit(5000);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of data ?? []) {
    const c = (r as { city_detected: string | null }).city_detected;
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}
