import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const replaceMock = vi.fn();
let currentParams: URLSearchParams = new URLSearchParams();
const pathnameMock = vi.fn(() => "/customers");

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentParams,
  usePathname: () => pathnameMock(),
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { useDataTableUrlState } from "@/hooks/use-data-table-url-state";

function setUrl(query: string) {
  currentParams = new URLSearchParams(query);
}

beforeEach(() => {
  replaceMock.mockClear();
  pathnameMock.mockClear();
  pathnameMock.mockReturnValue("/customers");
  setUrl("");
});

describe("useDataTableUrlState — URL parsing (Step 3 scenarios)", () => {
  it("SCEN-001 hydration: ?q=lopez with searchColumn populates columnFilters", () => {
    setUrl("q=lopez");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.columnFilters).toEqual([
      { id: "full_name", value: "lopez" },
    ]);
  });

  it("SCEN-001 hydration: ?q without searchColumn is ignored", () => {
    setUrl("q=lopez");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.columnFilters).toEqual([]);
  });

  it("SCEN-002 hydration: ?sort=full_name:asc maps to sorting state", () => {
    setUrl("sort=full_name:asc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([{ id: "full_name", desc: false }]);
  });

  it("SCEN-002 hydration: ?sort=full_name:desc maps with desc=true", () => {
    setUrl("sort=full_name:desc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([{ id: "full_name", desc: true }]);
  });

  it("SCEN-002 hydration: ?page=2 maps to pageIndex=1 with default pageSize=20", () => {
    setUrl("page=2");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination).toEqual({ pageIndex: 1, pageSize: 20 });
  });

  it("SCEN-002 hydration: missing page defaults to pageIndex=0", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 20 });
  });

  it("SCEN-002 hydration: respects custom pageSize option", () => {
    setUrl("page=3");
    const { result } = renderHook(() =>
      useDataTableUrlState({ pageSize: 50 }),
    );

    expect(result.current.pagination).toEqual({ pageIndex: 2, pageSize: 50 });
  });

  it("SCEN-003: pasted URL hydrates all three (q, sort, page) simultaneously", () => {
    setUrl("q=lopez&sort=full_name:asc&page=2");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.columnFilters).toEqual([
      { id: "full_name", value: "lopez" },
    ]);
    expect(result.current.sorting).toEqual([{ id: "full_name", desc: false }]);
    expect(result.current.pagination).toEqual({ pageIndex: 1, pageSize: 20 });
  });

  it("SCEN-008 sanitization: ?page=abc coerces to pageIndex=0", () => {
    setUrl("page=abc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-008 sanitization: ?page=-3 coerces to pageIndex=0", () => {
    setUrl("page=-3");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-008 sanitization: ?sort=full_name:invalid is ignored (no sorting applied)", () => {
    setUrl("sort=full_name:invalid");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([]);
  });

  it("SCEN-008 sanitization: ?sort=Bad Column:asc (whitespace) is ignored", () => {
    setUrl("sort=" + encodeURIComponent("Bad Column") + ":asc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([]);
  });

  it("SCEN-008 sanitization: ?sort with shell metachars in id is ignored", () => {
    setUrl("sort=" + encodeURIComponent("foo;DROP") + ":asc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([]);
  });

  it("SCEN-008 sanitization: ?q= (empty) does not populate columnFilters", () => {
    setUrl("q=");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.columnFilters).toEqual([]);
  });

  it("SCEN-008 sanitization: combined malformed URL produces full defaults without throwing", () => {
    setUrl("page=abc&sort=full_name:invalid&q=");

    expect(() =>
      renderHook(() =>
        useDataTableUrlState({ searchColumn: "full_name" }),
      ),
    ).not.toThrow();

    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );
    expect(result.current.columnFilters).toEqual([]);
    expect(result.current.sorting).toEqual([]);
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 20 });
  });
});

function lastReplaceUrl(): string {
  expect(replaceMock).toHaveBeenCalled();
  const args = replaceMock.mock.calls.at(-1);
  return args?.[0] as string;
}

describe("useDataTableUrlState — sort + pagination setters", () => {
  it("SCEN-007: onPaginationChange preserves q + sort and writes page key", () => {
    setUrl("q=lopez&sort=full_name:asc");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onPaginationChange({ pageIndex: 1, pageSize: 20 });
    });

    const url = lastReplaceUrl();
    expect(url).toMatch(/^\/customers\?/);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("q")).toBe("lopez");
    expect(qs.get("sort")).toBe("full_name:asc");
    expect(qs.get("page")).toBe("2");
  });

  it("SCEN-007: pageIndex=0 drops the page key (page 1 is implicit)", () => {
    setUrl("q=lopez&page=3");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onPaginationChange({ pageIndex: 0, pageSize: 20 });
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("page")).toBe(false);
    expect(qs.get("q")).toBe("lopez");
  });

  it("SCEN-006 (sort variant): onSortingChange resets page and preserves q", () => {
    setUrl("page=3&q=lopez");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onSortingChange([{ id: "full_name", desc: false }]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("full_name:asc");
    expect(qs.get("q")).toBe("lopez");
    expect(qs.has("page")).toBe(false);
  });

  it("clearing sort drops the sort key", () => {
    setUrl("sort=full_name:asc&q=lopez");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onSortingChange([]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("sort")).toBe(false);
    expect(qs.get("q")).toBe("lopez");
  });

  it("setters preserve foreign keys (commissions-style server-side filters)", () => {
    setUrl("match_status=unmatched&payment_status=pending");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onSortingChange([{ id: "amount", desc: true }]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("match_status")).toBe("unmatched");
    expect(qs.get("payment_status")).toBe("pending");
    expect(qs.get("sort")).toBe("amount:desc");
  });

  it("setter accepts updater function form (react-table protocol)", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onPaginationChange((prev) => ({
        ...prev,
        pageIndex: prev.pageIndex + 2,
      }));
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("page")).toBe("3");
  });
});

describe("useDataTableUrlState — input buffer (SCEN-011)", () => {
  it("SCEN-011: searchInput updates synchronously without waiting for URL flush", () => {
    setUrl("");
    const { result, rerender } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.searchInput).toBe("");

    act(() => {
      result.current.setSearchInput("l");
    });
    expect(result.current.searchInput).toBe("l");

    act(() => {
      result.current.setSearchInput("lo");
    });
    expect(result.current.searchInput).toBe("lo");

    act(() => {
      result.current.setSearchInput("lop");
    });
    expect(result.current.searchInput).toBe("lop");

    // URL has not been written yet — only the buffer is updated synchronously.
    expect(replaceMock).not.toHaveBeenCalled();

    rerender();
    expect(result.current.searchInput).toBe("lop");
  });

  it("SCEN-011: searchInput hydrates from URL on mount", () => {
    setUrl("q=lopez");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.searchInput).toBe("lopez");
  });

  it("SCEN-011: external URL change re-syncs searchInput", () => {
    setUrl("q=old");
    const { result, rerender } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    expect(result.current.searchInput).toBe("old");

    setUrl("q=new");
    rerender();

    expect(result.current.searchInput).toBe("new");
  });

  it("SCEN-011: searchInput is empty string when searchColumn is undefined", () => {
    setUrl("q=ignored");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.searchInput).toBe("");
  });
});

describe("useDataTableUrlState — sort serialization for non-snake_case ids (SCEN-012)", () => {
  it("SCEN-012: camelCase column id serializes to URL", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onSortingChange([{ id: "createdAt", desc: false }]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("createdAt:asc");
  });

  it("SCEN-012: hyphenated column id serializes to URL", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onSortingChange([{ id: "id-1", desc: true }]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("id-1:desc");
  });

  it("SCEN-012: dotted column id serializes to URL", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onSortingChange([{ id: "amount.usd", desc: false }]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("amount.usd:asc");
  });

  it("SCEN-012 round-trip: camelCase sort survives the re-render after URL write", () => {
    setUrl("sort=createdAt:asc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([
      { id: "createdAt", desc: false },
    ]);
  });

  it("SCEN-012 round-trip: hyphenated sort survives the re-render", () => {
    setUrl("sort=id-1:desc");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([{ id: "id-1", desc: true }]);
  });
});

describe("useDataTableUrlState — pagination sanitization (SCEN-013, SCEN-014)", () => {
  it("SCEN-013: ?page=1e10 is rejected", () => {
    setUrl("page=1e10");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-013: ?page=0x10 is rejected", () => {
    setUrl("page=0x10");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-013: ?page=1e15 is rejected", () => {
    setUrl("page=1e15");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-013: ?page=9007199254740990 (beyond MAX_PAGE) is rejected", () => {
    setUrl("page=9007199254740990");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.pagination.pageIndex).toBe(0);
  });

  it("SCEN-014: serializePage produces digit string or drops key, never scientific notation", () => {
    setUrl("");
    const { result } = renderHook(() => useDataTableUrlState());

    act(() => {
      result.current.onPaginationChange({ pageIndex: 1e21, pageSize: 20 });
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    const pageRaw = qs.get("page");
    if (pageRaw !== null) {
      expect(pageRaw).toMatch(/^\d+$/);
    }
    expect(url).not.toMatch(/[eE]\+/);
  });
});

describe("useDataTableUrlState — sort exact arity (SCEN-015)", () => {
  it("SCEN-015: ?sort=full_name:asc:extra rejected", () => {
    setUrl("sort=full_name:asc:extra");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([]);
  });

  it("SCEN-015: ?sort=full_name:asc: (trailing colon) rejected", () => {
    setUrl("sort=full_name:asc:");
    const { result } = renderHook(() => useDataTableUrlState());

    expect(result.current.sorting).toEqual([]);
  });
});

describe("useDataTableUrlState — debounced search setter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("SCEN-016: badge click during pending debounce preserves freshly-clicked filter", () => {
    setUrl("match_status=unmatched");
    const { result, rerender } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "match_id" }),
    );

    act(() => {
      result.current.setSearchInput("abc");
    });

    // Simulate badge navigation: URL changes BEFORE the debounce flushes.
    setUrl("match_status=unmatched&payment_status=pending");
    rerender();

    // Now the 250ms debounce fires.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("match_status")).toBe("unmatched");
    expect(qs.get("payment_status")).toBe("pending");
    expect(qs.get("q")).toBe("abc");
  });

  it("SCEN-009: rapid typing coalesces into a single router.replace after debounce", () => {
    setUrl("");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "l" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "lo" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "lop" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "lope" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "lopez" },
      ]);
    });

    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("q")).toBe("lopez");
  });

  it("SCEN-010: pending debounce does not fire after unmount", () => {
    setUrl("");
    const { result, unmount } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "l" },
      ]);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("SCEN-006 (filter variant): debounced search resets page to 1 when flushed", () => {
    setUrl("page=3");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onColumnFiltersChange([
        { id: "full_name", value: "x" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("q")).toBe("x");
    expect(qs.has("page")).toBe(false);
  });

  it("SCEN-004: debounced search preserves foreign keys (commissions)", () => {
    setUrl("match_status=unmatched");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "match_id" }),
    );

    act(() => {
      result.current.onColumnFiltersChange([
        { id: "match_id", value: "abc" },
      ]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("match_status")).toBe("unmatched");
    expect(qs.get("q")).toBe("abc");
  });

  it("clearing the filter removes the ?q= key after debounce", () => {
    setUrl("q=old&page=2");
    const { result } = renderHook(() =>
      useDataTableUrlState({ searchColumn: "full_name" }),
    );

    act(() => {
      result.current.onColumnFiltersChange([]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("q")).toBe(false);
    expect(qs.has("page")).toBe(false);
  });
});
