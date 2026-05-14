"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";

import {
  type DateRange,
  fromLocalIsoDate,
  toLocalIsoDate,
} from "@/lib/date-range";
import { FRANCHISES, RESERVATION_STATUSES } from "@/lib/schemas/reservation";

export const ALL = "__all__";
export const PRIORITY_SORT = { id: "priority", desc: false } as const;
export const DEFAULT_USER_SORT: SortingState = [
  { id: "created_at", desc: true },
];

export interface FilterState {
  franchise: string;
  status: string;
  city: string;
  referral: string;
  createdRange: DateRange | undefined;
  pickupRange: DateRange | undefined;
  search: string;
}

export const INITIAL_FILTERS: FilterState = {
  franchise: ALL,
  status: ALL,
  city: ALL,
  referral: ALL,
  createdRange: undefined,
  pickupRange: undefined,
  search: "",
};

export interface UseReservationsTableUrlStateOptions {
  pageSize?: number;
  searchDebounceMs?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const COLUMN_ID_RE = /^[\w.-]+$/;
const SORT_DIRS = new Set(["asc", "desc"]);
const PAGE_DIGITS_RE = /^\d+$/;
const MAX_PAGE = 10_000;
const FRANCHISE_SET = new Set<string>(FRANCHISES);
const STATUS_SET = new Set<string>(RESERVATION_STATUSES);

const MANAGED_KEYS = [
  "franchise",
  "status",
  "city",
  "referral",
  "created_from",
  "created_to",
  "pickup_from",
  "pickup_to",
  "q",
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

function parseStringFilter(params: URLSearchParams, key: string): string {
  const raw = params.get(key);
  return raw && raw.length > 0 ? raw : ALL;
}

function parseDateRange(
  params: URLSearchParams,
  fromKey: string,
  toKey: string,
): DateRange | undefined {
  const fromRaw = params.get(fromKey);
  const toRaw = params.get(toKey);
  const from = fromRaw ? fromLocalIsoDate(fromRaw) : undefined;
  const to = toRaw ? fromLocalIsoDate(toRaw) : undefined;
  if (!from && !to && !fromRaw && !toRaw) return undefined;
  if (!from && !to) return undefined;
  return { from, to };
}

function parseSorting(params: URLSearchParams): SortingState {
  const raw = params.get("sort");
  if (!raw) return [PRIORITY_SORT, ...DEFAULT_USER_SORT];
  const parts = raw.split(":");
  if (parts.length !== 2) return [PRIORITY_SORT];
  const [id, dir] = parts;
  if (!id || !COLUMN_ID_RE.test(id)) return [PRIORITY_SORT];
  if (!SORT_DIRS.has(dir)) return [PRIORITY_SORT];
  return [PRIORITY_SORT, { id, desc: dir === "desc" }];
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
  const userSort = state.filter((s) => s.id !== PRIORITY_SORT.id);
  if (userSort.length === 0) return null;
  if (isDefaultUserSort(userSort)) return null;
  const first = userSort[0];
  return `${first.id}:${first.desc ? "desc" : "asc"}`;
}

function serializePage(pageIndex: number): string | null {
  if (!Number.isFinite(pageIndex) || pageIndex <= 0) return null;
  const page = Math.min(Math.floor(pageIndex) + 1, MAX_PAGE);
  return page.toString(10);
}

function dateRangeKeys(
  key: "createdRange" | "pickupRange",
): { from: ManagedKey; to: ManagedKey } {
  if (key === "createdRange") {
    return { from: "created_from", to: "created_to" };
  }
  return { from: "pickup_from", to: "pickup_to" };
}

export function useReservationsTableUrlState(
  options?: UseReservationsTableUrlStateOptions,
) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paramsKey = searchParams?.toString() ?? "";

  const { filters, sorting, pagination, urlSearchValue } = useMemo(() => {
    const p = new URLSearchParams(paramsKey);
    const f: FilterState = {
      franchise: parseEnumFilter(p, "franchise", FRANCHISE_SET),
      status: parseEnumFilter(p, "status", STATUS_SET),
      city: parseStringFilter(p, "city"),
      referral: parseStringFilter(p, "referral"),
      createdRange: parseDateRange(p, "created_from", "created_to"),
      pickupRange: parseDateRange(p, "pickup_from", "pickup_to"),
      search: p.get("q") ?? "",
    };
    return {
      filters: f,
      sorting: parseSorting(p),
      pagination: parsePagination(p, pageSize),
      urlSearchValue: f.search,
    };
  }, [paramsKey, pageSize]);

  // Local buffer for the search Input — render-synchronous, independent of debounce.
  const [searchInput, setSearchInputState] = useState(urlSearchValue);
  const lastUrlSearchValue = useRef(urlSearchValue);
  useEffect(() => {
    if (urlSearchValue !== lastUrlSearchValue.current) {
      lastUrlSearchValue.current = urlSearchValue;
      setSearchInputState(urlSearchValue);
    }
  }, [urlSearchValue]);

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

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);
  useEffect(() => cancelPending, [cancelPending, pathname]);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      if (key === "search") {
        const next = String(value ?? "");
        setSearchInputState(next);
        cancelPending();
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          writeUrlRef.current({ q: next || null }, true);
        }, debounceMs);
        return;
      }
      if (key === "createdRange" || key === "pickupRange") {
        const range = value as DateRange | undefined;
        const { from, to } = dateRangeKeys(key);
        writeUrl(
          {
            [from]: range?.from ? toLocalIsoDate(range.from) : null,
            [to]: range?.to ? toLocalIsoDate(range.to) : null,
          },
          true,
        );
        return;
      }
      // Enum/string keys: ALL → drop key; other → set.
      const raw = String(value ?? "");
      writeUrl({ [key]: raw === ALL || raw === "" ? null : raw }, true);
    },
    [cancelPending, debounceMs, writeUrl],
  );

  const clearAll = useCallback(() => {
    cancelPending();
    setSearchInputState("");
    const next = new URLSearchParams(paramsKey);
    for (const key of MANAGED_KEYS) next.delete(key);
    const qs = next.toString();
    if (qs === paramsKey) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [cancelPending, paramsKey, pathname, router]);

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
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

  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    () => {
      // Reservations filters in useMemo outside react-table; no-op.
    },
    [],
  );

  return {
    filters,
    searchInput,
    setFilter,
    clearAll,
    sorting,
    pagination,
    onSortingChange,
    onPaginationChange,
    onColumnFiltersChange,
  };
}
