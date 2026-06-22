"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";

import {
  type DateRange,
  fromLocalIsoDate,
  toLocalIsoDate,
} from "@/lib/date-range";
import {
  ALL,
  CHAT_BRANDS,
  CHAT_STATUSES,
  REVIEW_LABELS,
  UNREVIEWED,
  SORTABLE_COLUMNS,
} from "@/lib/chat/list-params";

// Trimmed clone of use-reservations-table-url-state for the conversations list.
// Cloned rather than generalized so the reservations hook stays untouched (no
// regression risk). No free-text search in V1 (full-text deferred), so there's
// no debounce machinery here. URL search params are the single source of truth.

export const DEFAULT_USER_SORT: SortingState = [
  { id: "created_at", desc: true },
];

export interface FilterState {
  brand: string;
  status: string;
  review: string;
  city: string;
  createdRange: DateRange | undefined;
}

export const INITIAL_FILTERS: FilterState = {
  brand: ALL,
  status: ALL,
  review: ALL,
  city: ALL,
  createdRange: undefined,
};

const DEFAULT_PAGE_SIZE = 20;
const COLUMN_ID_RE = /^[\w.-]+$/;
const SORT_DIRS = new Set(["asc", "desc"]);
const PAGE_DIGITS_RE = /^\d+$/;
const MAX_PAGE = 10_000;
const BRAND_SET = new Set<string>(CHAT_BRANDS);
const STATUS_SET = new Set<string>(CHAT_STATUSES);
const REVIEW_SET = new Set<string>(REVIEW_LABELS);

const MANAGED_KEYS = [
  "brand",
  "status",
  "review",
  "city",
  "created_from",
  "created_to",
  "sort",
  "page",
] as const;

type ManagedKey = (typeof MANAGED_KEYS)[number];

function parseEnumFilter(
  params: URLSearchParams,
  key: string,
  allowed: Set<string>,
): string {
  const raw = params.get(key);
  if (!raw) return ALL;
  return allowed.has(raw) ? raw : ALL;
}

// review accepts the UNREVIEWED sentinel in addition to the labels.
function parseReviewFilter(params: URLSearchParams): string {
  const raw = params.get("review");
  if (!raw) return ALL;
  if (raw === UNREVIEWED) return UNREVIEWED;
  return REVIEW_SET.has(raw) ? raw : ALL;
}

function parseStringFilter(params: URLSearchParams, key: string): string {
  const raw = params.get(key);
  return raw && raw.length > 0 ? raw : ALL;
}

function parseDateRange(
  params: URLSearchParams,
  fromKey: string,
  toKey: string,
): DateRange | undefined {
  const from = fromLocalIsoDate(params.get(fromKey) ?? "");
  const to = fromLocalIsoDate(params.get(toKey) ?? "");
  if (!from && !to) return undefined;
  if (from && to && toLocalIsoDate(from) > toLocalIsoDate(to)) {
    return { from: to, to: from };
  }
  return { from, to };
}

function parseSorting(params: URLSearchParams): SortingState {
  const raw = params.get("sort");
  if (!raw) return DEFAULT_USER_SORT;
  const parts = raw.split(":");
  if (parts.length !== 2) return DEFAULT_USER_SORT;
  const [id, dir] = parts;
  if (!id || !COLUMN_ID_RE.test(id) || !(id in SORTABLE_COLUMNS))
    return DEFAULT_USER_SORT;
  if (!SORT_DIRS.has(dir)) return DEFAULT_USER_SORT;
  return [{ id, desc: dir === "desc" }];
}

function parsePagination(
  params: URLSearchParams,
  pageSize: number,
): PaginationState {
  const raw = params.get("page");
  if (!raw || !PAGE_DIGITS_RE.test(raw)) return { pageIndex: 0, pageSize };
  const parsed = Number(raw);
  if (parsed < 1 || parsed > MAX_PAGE) return { pageIndex: 0, pageSize };
  return { pageIndex: parsed - 1, pageSize };
}

function isDefaultUserSort(state: SortingState): boolean {
  if (state.length !== DEFAULT_USER_SORT.length) return false;
  return state.every((s, i) => {
    const def = DEFAULT_USER_SORT[i];
    return s.id === def.id && s.desc === def.desc;
  });
}

function serializeSort(state: SortingState): string | null {
  if (state.length === 0) return null;
  if (isDefaultUserSort(state)) return null;
  const first = state[0];
  return `${first.id}:${first.desc ? "desc" : "asc"}`;
}

function serializePage(pageIndex: number): string | null {
  if (!Number.isFinite(pageIndex) || pageIndex <= 0) return null;
  const page = Math.min(Math.floor(pageIndex) + 1, MAX_PAGE);
  return page.toString(10);
}

export function useConversationsTableUrlState(options?: { pageSize?: number }) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paramsKey = searchParams?.toString() ?? "";

  const { filters, sorting, pagination } = useMemo(() => {
    const p = new URLSearchParams(paramsKey);
    const f: FilterState = {
      brand: parseEnumFilter(p, "brand", BRAND_SET),
      status: parseEnumFilter(p, "status", STATUS_SET),
      review: parseReviewFilter(p),
      city: parseStringFilter(p, "city"),
      createdRange: parseDateRange(p, "created_from", "created_to"),
    };
    return {
      filters: f,
      sorting: parseSorting(p),
      pagination: parsePagination(p, pageSize),
    };
  }, [paramsKey, pageSize]);

  const writeUrl = useCallback(
    (
      updates: Partial<Record<ManagedKey, string | null>>,
      resetPage: boolean,
    ) => {
      const next = new URLSearchParams(paramsKey);
      for (const [key, value] of Object.entries(updates) as Array<
        [ManagedKey, string | null | undefined]
      >) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      if (resetPage) next.delete("page");
      const qs = next.toString();
      if (qs === paramsKey) return;
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [paramsKey, pathname, router],
  );

  const writeUrlRef = useRef(writeUrl);
  useEffect(() => {
    writeUrlRef.current = writeUrl;
  }, [writeUrl]);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      if (key === "createdRange") {
        const range = value as DateRange | undefined;
        writeUrl(
          {
            created_from: range?.from ? toLocalIsoDate(range.from) : null,
            created_to: range?.to ? toLocalIsoDate(range.to) : null,
          },
          true,
        );
        return;
      }
      const raw = value as string;
      writeUrl({ [key]: raw && raw !== ALL ? raw : null }, true);
    },
    [writeUrl],
  );

  const clearAll = useCallback(() => {
    const updates: Partial<Record<ManagedKey, null>> = {};
    for (const key of MANAGED_KEYS) updates[key] = null;
    writeUrl(updates, false);
  }, [writeUrl]);

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      writeUrl({ sort: serializeSort(next) }, true);
    },
    [sorting, writeUrl],
  );

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      writeUrl({ page: serializePage(next.pageIndex) }, false);
    },
    [pagination, writeUrl],
  );

  return {
    filters,
    setFilter,
    clearAll,
    sorting,
    pagination,
    onSortingChange,
    onPaginationChange,
  };
}
