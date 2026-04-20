"use client";

import { useCallback, useMemo, useState } from "react";
import {
  type ColumnFiltersState,
  type OnChangeFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EraserIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FRANCHISES,
  RESERVATION_STATUSES,
  STATUS_LABELS,
  isPriorityStatus,
  type ReservationStatus,
} from "@/lib/schemas/reservation";
import { columns, type ReservationRow } from "./columns";

type ReferralOption = { id: string; name: string };

interface ReservationsTableProps {
  data: ReservationRow[];
  referrals: ReferralOption[];
}

const ALL = "__all__";
const PRIORITY_SORT = { id: "priority", desc: false } as const;

const initialFilters = {
  franchise: ALL,
  status: ALL,
  referral: ALL,
  createdFrom: "",
  createdTo: "",
  pickupFrom: "",
  pickupTo: "",
  search: "",
};

type FilterState = typeof initialFilters;

function matchesSearch(row: ReservationRow, term: string) {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const fields = [
    row.customers
      ? `${row.customers.first_name} ${row.customers.last_name}`
      : "",
    row.customers?.identification_number ?? "",
    row.customers?.email ?? "",
    row.customers?.phone ?? "",
    row.reservation_code ?? "",
  ];
  return fields.some((f) => f.toLowerCase().includes(needle));
}

function inDateRange(iso: string, from: string, to: string) {
  if (!from && !to) return true;
  const value = iso.slice(0, 10);
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export function ReservationsTable({
  data,
  referrals,
}: ReservationsTableProps) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [sorting, setSortingRaw] = useState<SortingState>([
    PRIORITY_SORT,
    { id: "created_at", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const setSorting = useCallback<OnChangeFn<SortingState>>((updater) => {
    setSortingRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const withoutPriority = next.filter((s) => s.id !== "priority");
      return [PRIORITY_SORT, ...withoutPriority];
    });
  }, []);

  const filtered = useMemo(() => {
    return data.filter((row) => {
      if (filters.franchise !== ALL && row.franchise !== filters.franchise)
        return false;
      if (filters.status !== ALL && row.status !== filters.status) return false;
      if (
        filters.referral !== ALL &&
        (row.referrals?.id ?? row.referral_id ?? "") !== filters.referral
      )
        return false;
      if (
        !inDateRange(row.created_at, filters.createdFrom, filters.createdTo)
      )
        return false;
      if (
        !inDateRange(row.pickup_date, filters.pickupFrom, filters.pickupTo)
      )
        return false;
      if (!matchesSearch(row, filters.search)) return false;
      return true;
    });
  }, [data, filters]);

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    initialState: {
      pagination: { pageSize: 20 },
      columnVisibility: { priority: false },
    },
    state: { sorting, columnFilters },
  });

  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const clearAll = () => setFilters(initialFilters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Franquicia</label>
          <Select
            value={filters.franchise}
            onValueChange={(v) => update("franchise", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Franquicia" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {FRANCHISES.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Estado</label>
          <Select
            value={filters.status}
            onValueChange={(v) => update("status", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {RESERVATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s as ReservationStatus]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Creación</label>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={filters.createdFrom}
              onChange={(e) => update("createdFrom", e.target.value)}
              className="w-36"
              aria-label="Creación desde"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={filters.createdTo}
              onChange={(e) => update("createdTo", e.target.value)}
              className="w-36"
              aria-label="Creación hasta"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Recogida</label>
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={filters.pickupFrom}
              onChange={(e) => update("pickupFrom", e.target.value)}
              className="w-36"
              aria-label="Recogida desde"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              value={filters.pickupTo}
              onChange={(e) => update("pickupTo", e.target.value)}
              className="w-36"
              aria-label="Recogida hasta"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Referido</label>
          <Select
            value={filters.referral}
            onValueChange={(v) => update("referral", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Referido" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {referrals.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-muted-foreground">Buscador</label>
          <Input
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Nombre, ID, email, código…"
            className="min-w-[200px]"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={clearAll}
          aria-label="Limpiar filtros"
          title="Limpiar filtros"
        >
          <EraserIcon />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full caption-bottom text-sm">
          <thead className="border-b border-border bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "h-10 px-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap",
                      header.column.getCanSort() &&
                        "cursor-pointer select-none",
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {{
                      asc: " \u2191",
                      desc: " \u2193",
                    }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody className="[&_tr:last-child]:border-0">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const priority = isPriorityStatus(row.original.status);
                return (
                  <tr
                    key={row.id}
                    data-priority={priority ? "true" : undefined}
                    className={cn(
                      "border-b border-border transition-colors hover:bg-muted/50",
                      priority &&
                        "bg-amber-50/70 hover:bg-amber-100/60 dark:bg-amber-950/25 dark:hover:bg-amber-900/35",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2 align-middle whitespace-nowrap"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} resultado(s)
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            {table.getState().pagination.pageIndex + 1} /{" "}
            {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Siguiente
          </Button>
        </div>
      </div>
    </div>
  );
}
