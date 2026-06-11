import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

let currentParams: URLSearchParams = new URLSearchParams();
const pathnameMock = vi.fn(() => "/reservations");

// Hook now writes via router.replace (issue #100) so the dynamic Server
// Component refetches with the new searchParams — pagination/filtering/search
// run server-side. The test asserts the href passed to router.replace; the
// useSearchParams mock remains the URL source of truth (the mocked router does
// not mutate it, so tests drive URL settling manually via setUrl + rerender,
// exactly as before).
const replaceMock = vi.fn();

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

import {
  ALL,
  DEFAULT_USER_SORT,
  INITIAL_FILTERS,
  PRIORITY_SORT,
  useReservationsTableUrlState,
} from "@/hooks/use-reservations-table-url-state";

function setUrl(query: string) {
  currentParams = new URLSearchParams(query);
}

beforeEach(() => {
  replaceMock.mockClear();
  pathnameMock.mockClear();
  pathnameMock.mockReturnValue("/reservations");
  setUrl("");
});

afterEach(() => {
  vi.useRealTimers();
});

// router.replace(href, { scroll }) — the href is the first argument.
function lastReplaceUrl(): string {
  expect(replaceMock).toHaveBeenCalled();
  const args = replaceMock.mock.calls.at(-1);
  return args?.[0] as string;
}

describe("useReservationsTableUrlState — URL parsing (Steps 3+4)", () => {
  it("SCEN-006b default-sort fallback when URL has no sort key", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters).toEqual(INITIAL_FILTERS);
    expect(result.current.sorting).toEqual([
      PRIORITY_SORT,
      ...DEFAULT_USER_SORT,
    ]);
    expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 20 });
    expect(result.current.searchInput).toBe("");
  });

  it("SCEN-001 hydration: filters from URL", () => {
    setUrl(
      "franchise=alquilatucarro&status=pendiente&city=" +
        encodeURIComponent("city-uuid-1") +
        "&q=lopez",
    );
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.franchise).toBe("alquilatucarro");
    expect(result.current.filters.status).toBe("pendiente");
    expect(result.current.filters.city).toBe("city-uuid-1");
    expect(result.current.filters.search).toBe("lopez");
  });

  it("SCEN-001 unknown enum falls back to ALL", () => {
    setUrl("franchise=does_not_exist&status=invalid_status");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.franchise).toBe(ALL);
    expect(result.current.filters.status).toBe(ALL);
  });

  it("SCEN-008 origen hydration: valid channel parses verbatim", () => {
    setUrl("origen=google_ads");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.origen).toBe("google_ads");
  });

  it("SCEN-008 origen hydration: __unknown__ sentinel is preserved", () => {
    setUrl("origen=__unknown__");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.origen).toBe("__unknown__");
  });

  it("SCEN-008 origen hydration: out-of-enum value falls back to ALL", () => {
    setUrl("origen=bogus");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.origen).toBe(ALL);
  });

  it("SCEN-006 hydration: ?sort=pickup_date:asc maps with PRIORITY_SORT pinned", () => {
    setUrl("sort=pickup_date:asc");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.sorting).toEqual([
      PRIORITY_SORT,
      { id: "pickup_date", desc: false },
    ]);
  });

  it("SCEN-006 hydration: ?sort=invalid is ignored, falls to PRIORITY_SORT only", () => {
    setUrl("sort=col:bogus");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.sorting).toEqual([PRIORITY_SORT]);
  });

  it("SCEN-004 partial DateRange: only created_from yields { from, to: undefined }", () => {
    setUrl("created_from=2026-05-01");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const range = result.current.filters.createdRange;
    expect(range).toBeDefined();
    expect(range?.from?.getFullYear()).toBe(2026);
    expect(range?.from?.getMonth()).toBe(4);
    expect(range?.from?.getDate()).toBe(1);
    expect(range?.to).toBeUndefined();
  });

  it("SCEN-004 full DateRange hydrates both endpoints", () => {
    setUrl("pickup_from=2026-05-01&pickup_to=2026-05-31");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const range = result.current.filters.pickupRange;
    expect(range?.from?.getDate()).toBe(1);
    expect(range?.to?.getDate()).toBe(31);
    expect(range?.to?.getMonth()).toBe(4);
  });

  it("SCEN-004 malformed date is dropped (undefined endpoint)", () => {
    setUrl("created_from=not-a-date&created_to=2026-05-31");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const range = result.current.filters.createdRange;
    expect(range?.from).toBeUndefined();
    expect(range?.to?.getDate()).toBe(31);
  });

  it("SCEN-017 inverted DateRange is normalized by swapping endpoints", () => {
    setUrl("pickup_from=2026-12-31&pickup_to=2026-01-01");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const range = result.current.filters.pickupRange;
    expect(range?.from?.getMonth()).toBe(0); // January after swap
    expect(range?.from?.getDate()).toBe(1);
    expect(range?.to?.getMonth()).toBe(11); // December after swap
    expect(range?.to?.getDate()).toBe(31);
  });

  it("SCEN-017 single-day range (from === to) is not swapped", () => {
    setUrl("created_from=2026-05-14&created_to=2026-05-14");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const range = result.current.filters.createdRange;
    expect(range?.from?.getDate()).toBe(14);
    expect(range?.to?.getDate()).toBe(14);
  });

  it("SCEN-014 full pasted URL hydrates everything", () => {
    setUrl(
      "franchise=alquilatucarro&status=pendiente&pickup_from=2026-05-01&pickup_to=2026-05-31&q=lopez&sort=created_at:desc&page=2",
    );
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.filters.franchise).toBe("alquilatucarro");
    expect(result.current.filters.status).toBe("pendiente");
    expect(result.current.filters.pickupRange?.from?.getDate()).toBe(1);
    expect(result.current.filters.pickupRange?.to?.getDate()).toBe(31);
    expect(result.current.filters.search).toBe("lopez");
    expect(result.current.sorting).toEqual([
      PRIORITY_SORT,
      { id: "created_at", desc: true },
    ]);
    expect(result.current.pagination).toEqual({ pageIndex: 1, pageSize: 20 });
  });

  it("SCEN-014 page sanitization: page=abc, page=-1, page=1e10 all coerce to 1", () => {
    for (const raw of ["abc", "-1", "1e10", "0", "9007199254740990"]) {
      setUrl(`page=${raw}`);
      const { result } = renderHook(() => useReservationsTableUrlState());
      expect(result.current.pagination.pageIndex).toBe(0);
    }
  });
});

describe("useReservationsTableUrlState — setters", () => {
  it("SCEN-002 setFilter(franchise, ALL) drops the franchise key", () => {
    setUrl("franchise=alquilatucarro");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("franchise", ALL);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("franchise")).toBe(false);
  });

  it("SCEN-002 setFilter(franchise, value) writes the key", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("franchise", "alquilame");
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("franchise")).toBe("alquilame");
  });

  it("SCEN-008 setFilter(origen, channel) writes the origen key", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("origen", "google_ads");
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("origen")).toBe("google_ads");
  });

  it("SCEN-008 setFilter(origen, __unknown__) writes the sentinel", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("origen", "__unknown__");
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("origen")).toBe("__unknown__");
  });

  it("SCEN-008 setFilter(origen, ALL) drops the origen key", () => {
    setUrl("origen=google_ads");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("origen", ALL);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("origen")).toBe(false);
  });

  it("SCEN-003 DateRange round-trip preserves Y/M/D across leap year", () => {
    setUrl("");
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.setFilter("createdRange", {
        from: new Date(2024, 1, 29),
        to: new Date(2024, 2, 1),
      });
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("created_from")).toBe("2024-02-29");
    expect(qs.get("created_to")).toBe("2024-03-01");

    setUrl(qs.toString());
    rerender();

    const range = result.current.filters.createdRange;
    expect(range?.from?.getFullYear()).toBe(2024);
    expect(range?.from?.getMonth()).toBe(1);
    expect(range?.from?.getDate()).toBe(29);
    expect(range?.to?.getFullYear()).toBe(2024);
    expect(range?.to?.getMonth()).toBe(2);
    expect(range?.to?.getDate()).toBe(1);
  });

  it("SCEN-003 DateRange round-trip across year boundary", () => {
    setUrl("");
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.setFilter("pickupRange", {
        from: new Date(2026, 11, 31),
        to: new Date(2027, 0, 1),
      });
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("pickup_from")).toBe("2026-12-31");
    expect(qs.get("pickup_to")).toBe("2027-01-01");

    setUrl(qs.toString());
    rerender();

    const range = result.current.filters.pickupRange;
    expect(range?.from?.getFullYear()).toBe(2026);
    expect(range?.from?.getMonth()).toBe(11);
    expect(range?.from?.getDate()).toBe(31);
    expect(range?.to?.getFullYear()).toBe(2027);
    expect(range?.to?.getMonth()).toBe(0);
    expect(range?.to?.getDate()).toBe(1);
  });

  it("SCEN-005 PRIORITY_SORT is stripped from URL serialization", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.onSortingChange([
        PRIORITY_SORT,
        { id: "pickup_date", desc: false },
      ]);
    });

    const url = lastReplaceUrl();
    expect(url).not.toMatch(/priority/);
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("pickup_date:asc");
  });

  it("SCEN-005 default user sort drops the URL sort key", () => {
    setUrl("sort=pickup_date:asc");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.onSortingChange([PRIORITY_SORT, ...DEFAULT_USER_SORT]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("sort")).toBe(false);
  });

  it("SCEN-005 sort=[] (just PRIORITY_SORT) drops the URL sort key", () => {
    setUrl("sort=pickup_date:asc");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.onSortingChange([PRIORITY_SORT]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.has("sort")).toBe(false);
  });

  it("SCEN-007 filter change resets page", () => {
    setUrl("page=3&status=pendiente");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("city", "city-uuid-1");
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("city")).toBe("city-uuid-1");
    expect(qs.get("status")).toBe("pendiente");
    expect(qs.has("page")).toBe(false);
  });

  it("SCEN-007 sort change resets page", () => {
    setUrl("page=3&status=pendiente");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.onSortingChange([
        PRIORITY_SORT,
        { id: "pickup_date", desc: true },
      ]);
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("sort")).toBe("pickup_date:desc");
    expect(qs.get("status")).toBe("pendiente");
    expect(qs.has("page")).toBe(false);
  });

  it("SCEN-008 page change preserves filters and sort", () => {
    setUrl("status=pendiente&sort=pickup_date:asc");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.onPaginationChange({ pageIndex: 1, pageSize: 20 });
    });

    const url = lastReplaceUrl();
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("status")).toBe("pendiente");
    expect(qs.get("sort")).toBe("pickup_date:asc");
    expect(qs.get("page")).toBe("2");
  });

  it("SCEN-011 writeUrl no-op skip", () => {
    setUrl("q=ana");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("franchise", ALL);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("SCEN-013 clearAll writes /reservations clean", () => {
    setUrl(
      "franchise=alquilatucarro&q=ana&sort=pickup_date:asc&page=3&status=pendiente",
    );
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.clearAll();
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("/reservations");

    // After URL settles, hook reflects default state.
    setUrl("");
    rerender();
    expect(result.current.filters).toEqual(INITIAL_FILTERS);
    expect(result.current.searchInput).toBe("");
    expect(result.current.sorting).toEqual([
      PRIORITY_SORT,
      ...DEFAULT_USER_SORT,
    ]);
  });
});

describe("useReservationsTableUrlState — search debounce + buffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("SCEN-012 searchInput updates synchronously, URL not yet changed", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    act(() => {
      result.current.setFilter("search", "ana");
    });

    expect(result.current.searchInput).toBe("ana");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("SCEN-001 searchInput hydrates from URL on mount", () => {
    setUrl("q=lopez");
    const { result } = renderHook(() => useReservationsTableUrlState());

    expect(result.current.searchInput).toBe("lopez");
  });

  it("SCEN-009 debounce coalesces rapid typing into one replace", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    for (const v of ["l", "lo", "lop", "lope", "lopez"]) {
      act(() => {
        result.current.setFilter("search", v);
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }

    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("q")).toBe("lopez");
  });

  it("SCEN-010 pending debounce does not fire after unmount", () => {
    setUrl("");
    const { result, unmount } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.setFilter("search", "ana");
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("SCEN-019 external URL change cancels pending search debounce", () => {
    setUrl("");
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.setFilter("search", "abc");
    });

    // External URL change — back button / sidebar / Limpiar filtros.
    setUrl("franchise=alquilatucarro");
    rerender();

    // Debounce window passes.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("SCEN-020 search input is truncated to SEARCH_MAX_LEN characters", () => {
    setUrl("");
    const { result } = renderHook(() => useReservationsTableUrlState());

    const huge = "x".repeat(5000);
    act(() => {
      result.current.setFilter("search", huge);
    });

    // Buffer is truncated synchronously.
    expect(result.current.searchInput.length).toBe(200);
    expect(result.current.searchInput).toBe("x".repeat(200));

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0]?.[0] as string;
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("q")?.length).toBe(200);
  });

  it("SCEN-016 mid-debounce filter change preserves freshly-changed filter", () => {
    setUrl("status=pendiente");
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    act(() => {
      result.current.setFilter("search", "abc");
    });

    expect(replaceMock).not.toHaveBeenCalled();

    // Synchronous filter change (non-debounced) writes URL immediately.
    act(() => {
      result.current.setFilter("status", "nueva");
    });

    // Simulate the URL changing as soft-nav lands.
    setUrl("status=nueva");
    rerender();

    // Debounce fires.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Two replace calls total: status change + search flush.
    expect(replaceMock).toHaveBeenCalledTimes(2);
    const finalUrl = replaceMock.mock.calls.at(-1)?.[0] as string;
    const qs = new URLSearchParams(finalUrl.split("?")[1] ?? "");
    expect(qs.get("status")).toBe("nueva");
    expect(qs.get("q")).toBe("abc");
  });

  it("SCEN-021 internal write after replace does not spuriously cancel pending search debounce", () => {
    // Highest-risk assumption (R1): the write cadence must not split the
    // paramsKey transition and misclassify an internal write as external. An
    // internal setFilter (enum) while a search debounce is pending must NOT
    // cancel that debounce — both q and the enum filter must reach the URL.
    // Complements SCEN-019 (external path).
    setUrl("");
    const { result, rerender } = renderHook(() =>
      useReservationsTableUrlState(),
    );

    // Search typed → 250ms debounce armed.
    act(() => {
      result.current.setFilter("search", "abc");
    });

    expect(replaceMock).not.toHaveBeenCalled();

    // Internal write: synchronous enum filter change while debounce pending.
    act(() => {
      result.current.setFilter("status", "pendiente");
    });

    // Soft-nav lands — URL reflects the internal write.
    setUrl("status=pendiente");
    rerender();

    // Debounce window elapses.
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Debounce was NOT spuriously cancelled: enum write + search flush.
    expect(replaceMock).toHaveBeenCalledTimes(2);
    const params = new URLSearchParams(lastReplaceUrl().split("?")[1] ?? "");
    expect(params.get("q")).toBe("abc");
    expect(params.get("status")).toBe("pendiente");
  });
});
