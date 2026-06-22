import { describe, it, expect } from "vitest";
import { useState } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  useReactTable,
  getCoreRowModel,
  type SortingState,
} from "@tanstack/react-table";
import { columns } from "@/app/(dashboard)/reservations/columns";
import { PRIORITY_SORT } from "@/hooks/use-reservations-table-url-state";

// Mirror the sorting-relevant useReactTable options from reservations-table.tsx
// so this exercises the REAL toggle cycle, not a theoretical one. The stuck-
// toggle bug lived exactly in this interaction: with enableSortingRemoval on
// (the @tanstack default) a column already at its non-first direction cycled to
// "no sort", which serialized to null and let the server re-apply the same
// default — so the click did nothing. enableSortingRemoval:false + sortDescFirst
// turn every sortable header into a clean desc⇄asc flip, descending first.
function useSortTable(initial: SortingState) {
  const [sorting, setSorting] = useState<SortingState>(initial);
  const table = useReactTable({
    data: [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSortingRemoval: false,
    sortDescFirst: true,
    state: { sorting },
    onSortingChange: setSorting,
  });
  return { table };
}

// The default order rendered before any click: priority floats first, then
// created_at desc.
const DEFAULT_STATE: SortingState = [
  PRIORITY_SORT,
  { id: "created_at", desc: true },
];

describe("reservations sort toggle (stuck-desc-toggle fix)", () => {
  it("created_at flips desc → asc → desc, never stranding on 'no sort'", () => {
    const { result } = renderHook(() => useSortTable(DEFAULT_STATE));
    const sortDir = () =>
      result.current.table.getColumn("created_at")!.getIsSorted();

    expect(sortDir()).toBe("desc"); // default render
    act(() => result.current.table.getColumn("created_at")!.toggleSorting());
    expect(sortDir()).toBe("asc");
    act(() => result.current.table.getColumn("created_at")!.toggleSorting());
    expect(sortDir()).toBe("desc");
  });

  it("franchise first click is descending (mayor a menor), then toggles ascending", () => {
    const { result } = renderHook(() => useSortTable(DEFAULT_STATE));
    const sortDir = () =>
      result.current.table.getColumn("franchise")!.getIsSorted();

    expect(sortDir()).toBe(false); // not sorted until clicked
    act(() => result.current.table.getColumn("franchise")!.toggleSorting());
    expect(sortDir()).toBe("desc");
    act(() => result.current.table.getColumn("franchise")!.toggleSorting());
    expect(sortDir()).toBe("asc");
  });

  it("only the indexed columns are sortable; joined/derived/unindexed are not", () => {
    const { result } = renderHook(() => useSortTable(DEFAULT_STATE));
    const t = result.current.table;

    for (const id of ["created_at", "franchise", "origen"]) {
      expect(t.getColumn(id)!.getCanSort(), id).toBe(true);
    }
    for (const id of ["pickup_city", "pickup", "total_with_tax", "status"]) {
      expect(t.getColumn(id)!.getCanSort(), id).toBe(false);
    }
  });
});
