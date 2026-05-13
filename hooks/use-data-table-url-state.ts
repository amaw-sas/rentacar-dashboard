"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
  Updater,
} from "@tanstack/react-table";

export interface UseDataTableUrlStateOptions {
  searchColumn?: string;
  pageSize?: number;
  searchDebounceMs?: number;
}

export interface UseDataTableUrlStateReturn {
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  pagination: PaginationState;
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
  onSortingChange: OnChangeFn<SortingState>;
  onPaginationChange: OnChangeFn<PaginationState>;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const COLUMN_ID_RE = /^[a-z0-9_]+$/;
const SORT_DIRS = new Set(["asc", "desc"]);

type ManagedKey = "q" | "sort" | "page";

function parseColumnFilters(
  params: URLSearchParams,
  searchColumn: string | undefined,
): ColumnFiltersState {
  if (!searchColumn) return [];
  const raw = params.get("q");
  if (!raw) return [];
  return [{ id: searchColumn, value: raw }];
}

function parseSorting(params: URLSearchParams): SortingState {
  const raw = params.get("sort");
  if (!raw) return [];
  const [id, dir] = raw.split(":");
  if (!id || !dir) return [];
  if (!COLUMN_ID_RE.test(id)) return [];
  if (!SORT_DIRS.has(dir)) return [];
  return [{ id, desc: dir === "desc" }];
}

function parsePagination(
  params: URLSearchParams,
  pageSize: number,
): PaginationState {
  const raw = params.get("page");
  if (!raw) return { pageIndex: 0, pageSize };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { pageIndex: 0, pageSize };
  }
  return { pageIndex: parsed - 1, pageSize };
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function"
    ? (updater as (prev: T) => T)(current)
    : updater;
}

function serializeSorting(state: SortingState): string | null {
  const first = state[0];
  if (!first) return null;
  if (!COLUMN_ID_RE.test(first.id)) return null;
  return `${first.id}:${first.desc ? "desc" : "asc"}`;
}

function serializePage(pageIndex: number): string | null {
  if (pageIndex <= 0) return null;
  return String(pageIndex + 1);
}

export function useDataTableUrlState(
  options?: UseDataTableUrlStateOptions,
): UseDataTableUrlStateReturn {
  const searchColumn = options?.searchColumn;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paramsKey = searchParams?.toString() ?? "";

  const { columnFilters, sorting, pagination } = useMemo(() => {
    const p = new URLSearchParams(paramsKey);
    return {
      columnFilters: parseColumnFilters(p, searchColumn),
      sorting: parseSorting(p),
      pagination: parsePagination(p, pageSize),
    };
  }, [paramsKey, searchColumn, pageSize]);

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
      const target = qs ? `${pathname}?${qs}` : pathname;
      router.replace(target, { scroll: false });
    },
    [paramsKey, pathname, router],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = resolveUpdater(updater, sorting);
      writeUrl({ sort: serializeSorting(next) }, true);
    },
    [sorting, writeUrl],
  );

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next = resolveUpdater(updater, pagination);
      writeUrl({ page: serializePage(next.pageIndex) }, false);
    },
    [pagination, writeUrl],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect(() => cancelPending, [cancelPending, pathname]);

  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    (updater) => {
      const next = resolveUpdater(updater, columnFilters);
      if (!searchColumn) return;
      const filter = next.find((f) => f.id === searchColumn);
      const value =
        filter?.value === undefined || filter.value === null
          ? null
          : String(filter.value);

      cancelPending();
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        writeUrl({ q: value || null }, true);
      }, debounceMs);
    },
    [columnFilters, searchColumn, writeUrl, cancelPending, debounceMs],
  );

  return {
    columnFilters,
    sorting,
    pagination,
    onColumnFiltersChange,
    onSortingChange,
    onPaginationChange,
  };
}
