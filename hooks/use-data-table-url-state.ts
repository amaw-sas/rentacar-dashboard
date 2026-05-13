"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";

export interface UseDataTableUrlStateOptions {
  searchColumn?: string;
  pageSize?: number;
  searchDebounceMs?: number;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const COLUMN_ID_RE = /^[a-z0-9_]+$/;
const SORT_DIRS = new Set(["asc", "desc"]);
const PAGE_DIGITS_RE = /^\d+$/;
const MAX_PAGE = 10_000;

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
  const parts = raw.split(":");
  if (parts.length !== 2) return [];
  const [id, dir] = parts;
  if (!id || !COLUMN_ID_RE.test(id)) return [];
  if (!SORT_DIRS.has(dir)) return [];
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

function serializePage(pageIndex: number): string | null {
  if (!Number.isFinite(pageIndex) || pageIndex <= 0) return null;
  const page = Math.min(Math.floor(pageIndex) + 1, MAX_PAGE);
  return page.toString(10);
}

export function useDataTableUrlState(options?: UseDataTableUrlStateOptions) {
  const searchColumn = options?.searchColumn;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const debounceMs = options?.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const paramsKey = searchParams?.toString() ?? "";

  const { columnFilters, sorting, pagination, urlSearchValue } = useMemo(() => {
    const p = new URLSearchParams(paramsKey);
    const filters = parseColumnFilters(p, searchColumn);
    return {
      columnFilters: filters,
      sorting: parseSorting(p),
      pagination: parsePagination(p, pageSize),
      urlSearchValue:
        searchColumn && filters[0]?.id === searchColumn
          ? String(filters[0].value)
          : "",
    };
  }, [paramsKey, searchColumn, pageSize]);

  // Decoupled buffer for the search input — render-synchronous, independent of
  // the debounced URL write. Without this, the controlled <Input> blanks on
  // every keystroke while waiting 250ms for the URL to flush.
  const [searchInput, setSearchInputState] = useState(urlSearchValue);
  const lastUrlSearchValue = useRef(urlSearchValue);
  useEffect(() => {
    if (urlSearchValue !== lastUrlSearchValue.current) {
      lastUrlSearchValue.current = urlSearchValue;
      setSearchInputState(urlSearchValue);
    }
  }, [urlSearchValue]);

  // Ref-routed writeUrl so the debounce flush always reads the latest URL
  // snapshot — without this, a navigation that happens before the debounce
  // fires (e.g. badge click in commissions) is silently overwritten.
  const writeUrl = useCallback(
    (key: "q" | "sort" | "page", value: string | null, resetPage: boolean) => {
      const next = new URLSearchParams(paramsKey);
      if (value) next.set(key, value);
      else next.delete(key);
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [paramsKey, pathname, router],
  );
  const writeUrlRef = useRef(writeUrl);
  useEffect(() => {
    writeUrlRef.current = writeUrl;
  }, [writeUrl]);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [pathname]);

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      if (!searchColumn) return;
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        writeUrlRef.current("q", value || null, true);
      }, debounceMs);
    },
    [searchColumn, debounceMs],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      const sortValue = first
        ? `${first.id}:${first.desc ? "desc" : "asc"}`
        : null;
      writeUrl("sort", sortValue, true);
    },
    [sorting, writeUrl],
  );

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      writeUrl("page", serializePage(next.pageIndex), false);
    },
    [pagination, writeUrl],
  );

  // Kept for react-table compatibility — column filter changes that don't go
  // through setSearchInput (rare). Mirrors setSearchInput's behavior.
  const onColumnFiltersChange = useCallback<OnChangeFn<ColumnFiltersState>>(
    (updater) => {
      if (!searchColumn) return;
      const next =
        typeof updater === "function" ? updater(columnFilters) : updater;
      const filter = next.find((f) => f.id === searchColumn);
      const value = filter?.value ? String(filter.value) : "";
      setSearchInput(value);
    },
    [columnFilters, searchColumn, setSearchInput],
  );

  return {
    columnFilters,
    sorting,
    pagination,
    searchInput,
    setSearchInput,
    onColumnFiltersChange,
    onSortingChange,
    onPaginationChange,
  };
}
