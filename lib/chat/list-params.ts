import { FRANCHISES } from "@/lib/schemas/reservation";

// Single source of truth for the conversations-list URL contract, shared by the
// server component (reads searchParams → query) and the client URL-state hook
// (writes searchParams). Keeping the key names + validation here prevents drift
// between what the client writes and what the server reads. Pure module: no
// "use client", no browser APIs — importable from both layers.
// Mirrors lib/reservations/list-params.ts. Chat Fase 2 · Incremento 1.

export const ALL = "__all__";
// review_label filter sentinel: "__unreviewed__" maps to review_label IS NULL
// downstream (conversations not yet graded). 'good'/'bad' are exact matches.
export const UNREVIEWED = "__unreviewed__";
export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 10_000;

// brand on chat_conversations is the franchise code (064 stores the marca).
export const CHAT_BRANDS = FRANCHISES;
export const CHAT_STATUSES = ["open", "closed", "handoff"] as const;
export const CHAT_STATUS_LABELS: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
  handoff: "Handoff",
};
export const REVIEW_LABELS = ["good", "bad"] as const;
export const REVIEW_LABEL_OPTIONS: Record<string, string> = {
  good: "Buena",
  bad: "Mala",
  [UNREVIEWED]: "Sin revisar",
};

const BRAND_SET = new Set<string>(CHAT_BRANDS);
const STATUS_SET = new Set<string>(CHAT_STATUSES);
const REVIEW_SET = new Set<string>(REVIEW_LABELS);

// Only created_at is server-sortable: idx_chat_conversations_created (064) backs
// it. Anything else falls back to the default order.
export const SORTABLE_COLUMNS: Record<string, string> = {
  created_at: "created_at",
};

export interface ConversationSort {
  column: string;
  ascending: boolean;
}

export const DEFAULT_SORT: ConversationSort = {
  column: "created_at",
  ascending: false,
};

export interface ChatConversationListParams {
  brand: string | null;
  status: string | null;
  // 'good' | 'bad' | UNREVIEWED sentinel | null (no filter)
  reviewLabel: string | null;
  city: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  sort: ConversationSort;
  page: number;
  pageSize: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_DIGITS_RE = /^\d+$/;

function enumOrNull(v: string | null, set: Set<string>): string | null {
  return v && set.has(v) ? v : null;
}

function reviewLabelOrNull(v: string | null): string | null {
  if (!v) return null;
  if (v === UNREVIEWED) return UNREVIEWED;
  return REVIEW_SET.has(v) ? v : null;
}

function stringOrNull(v: string | null): string | null {
  return v && v.length > 0 ? v : null;
}

function isoDateOrNull(v: string | null): string | null {
  return v && ISO_DATE_RE.test(v) ? v : null;
}

function parseSort(raw: string | null): ConversationSort {
  if (!raw) return DEFAULT_SORT;
  const [id, dir] = raw.split(":");
  const column = SORTABLE_COLUMNS[id ?? ""];
  if (!column || (dir !== "asc" && dir !== "desc")) return DEFAULT_SORT;
  return { column, ascending: dir === "asc" };
}

function parsePage(raw: string | null): number {
  if (!raw || !PAGE_DIGITS_RE.test(raw)) return 1;
  const n = Number(raw);
  if (n < 1 || n > MAX_PAGE) return 1;
  return n;
}

// ISO yyyy-mm-dd strings compare lexically, so a swapped range is detectable and
// fixable without parsing to Date. Mirrors the client hook's normalization.
function normalizeRange(
  from: string | null,
  to: string | null,
): [string | null, string | null] {
  if (from && to && from > to) return [to, from];
  return [from, to];
}

export function parseListParams(
  params: URLSearchParams,
): ChatConversationListParams {
  const [createdFrom, createdTo] = normalizeRange(
    isoDateOrNull(params.get("created_from")),
    isoDateOrNull(params.get("created_to")),
  );

  return {
    brand: enumOrNull(params.get("brand"), BRAND_SET),
    status: enumOrNull(params.get("status"), STATUS_SET),
    reviewLabel: reviewLabelOrNull(params.get("review")),
    city: stringOrNull(params.get("city")),
    createdFrom,
    createdTo,
    sort: parseSort(params.get("sort")),
    page: parsePage(params.get("page")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
