"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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
const SEARCH_MAX_LEN = 200;
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
  const from = fromLocalIsoDate(params.get(fromKey) ?? "");
  const to = fromLocalIsoDate(params.get(toKey) ?? "");
  if (!from && !to) return undefined;
  // Normalize inverted ranges — react-day-picker can emit a transient
  // {from: A, to: B} where B<A mid-drag, and hand-edited share links
  // sometimes swap endpoints by mistake. Swapping is more forgiving than
  // dropping the range silently (which would hide every row).
  if (from && to && toLocalIsoDate(from) > toLocalIsoDate(to)) {
    return { from: to, to: from };
  }
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

export function useReservationsTableUrlState(
  options?: UseReservationsTableUrlStateOptions,
) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;

  const searchParams = useSearchParams();
  const pathname = usePathname();
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
      search: (p.get("q") ?? "").slice(0, SEARCH_MAX_LEN),
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

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Distinguish "our writeUrl/clearAll set the URL" (internal) from
  // "browser back / sidebar nav set the URL" (external). External changes
  // must cancel any pending search debounce so the operator's discarded
  // typing does not clobber the new URL state.
  //
  // The detection lives in the render body (not a useEffect) because the
  // useEffect alternative trips react-hooks/immutability on the
  // debounceTimer mutation. The render-body pattern is idempotent —
  // subsequent renders with the same paramsKey skip the block, so a
  // Concurrent-Mode render retry is safe.
  const justWroteRef = useRef(false);
  const lastParamsKey = useRef(paramsKey);
  /* eslint-disable react-hooks/refs -- intentional render-body tracking;
     safe because the block is idempotent across re-renders */
  if (lastParamsKey.current !== paramsKey) {
    const externalChange = !justWroteRef.current;
    lastParamsKey.current = paramsKey;
    justWroteRef.current = false;
    if (externalChange && debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }
  /* eslint-enable react-hooks/refs */

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
      justWroteRef.current = true;
      if (typeof window !== "undefined") {
        window.history.replaceState(
          null,
          "",
          qs ? `${pathname}?${qs}` : pathname,
        );
      }
    },
    [paramsKey, pathname],
  );
  const writeUrlRef = useRef(writeUrl);
  useEffect(() => {
    writeUrlRef.current = writeUrl;
  }, [writeUrl]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [pathname]);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      if (key === "search") {
        const next = String(value ?? "").slice(0, SEARCH_MAX_LEN);
        setSearchInputState(next);
        if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          debounceTimer.current = null;
          writeUrlRef.current({ q: next || null }, true);
        }, debounceMs);
        return;
      }
      if (key === "createdRange" || key === "pickupRange") {
        const range = value as DateRange | undefined;
        const prefix = key === "createdRange" ? "created" : "pickup";
        writeUrl(
          {
            [`${prefix}_from`]: range?.from ? toLocalIsoDate(range.from) : null,
            [`${prefix}_to`]: range?.to ? toLocalIsoDate(range.to) : null,
          },
          true,
        );
        return;
      }
      // Enum/string keys: ALL or empty → drop key; other → set.
      const raw = value as string;
      writeUrl({ [key]: raw && raw !== ALL ? raw : null }, true);
    },
    [debounceMs, writeUrl],
  );

  const clearAll = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setSearchInputState("");
    const updates: Partial<Record<ManagedKey, null>> = {};
    for (const key of MANAGED_KEYS) updates[key] = null;
    writeUrl(updates, false);
  }, [writeUrl]);

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

  return {
    filters,
    searchInput,
    setFilter,
    clearAll,
    sorting,
    pagination,
    onSortingChange,
    onPaginationChange,
  };
}
