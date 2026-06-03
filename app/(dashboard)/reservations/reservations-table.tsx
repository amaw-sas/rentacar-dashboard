"use client";

import { useEffect, useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EraserIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { isWithinDateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import {
  ALL,
  useReservationsTableUrlState,
} from "@/hooks/use-reservations-table-url-state";
import { columns, type ReservationRow } from "./columns";

type ReferralOption = { id: string; name: string };
type CityOption = { id: string; name: string };

interface ReservationsTableProps {
  data: ReservationRow[];
  referrals: ReferralOption[];
  cities: CityOption[];
}

export const ALL_CITIES = ALL;

// Search keys off the booking-time snapshot (issue #26) so an operator can find
// a reservation by the identity the UI actually shows them. A global customer
// edit changes the live join but not the snapshot, so the displayed name and the
// searchable name stay in sync. Falls back to the live join defensively.
export function matchesSearch(row: ReservationRow, term: string) {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const fields = [
    row.customer_name_at_booking ??
      (row.customers
        ? `${row.customers.first_name} ${row.customers.last_name}`
        : ""),
    row.customer_identification_number_at_booking ??
      row.customers?.identification_number ??
      "",
    row.customer_email_at_booking ?? row.customers?.email ?? "",
    row.customer_phone_at_booking ?? row.customers?.phone ?? "",
    row.reservation_code ?? "",
  ];
  return fields.some((f) => f.toLowerCase().includes(needle));
}

export function matchesCity(row: ReservationRow, cityFilter: string) {
  if (cityFilter === ALL) return true;
  return row.pickup_location?.city_id === cityFilter;
}

export function ReservationsTable({
  data,
  referrals,
  cities,
}: ReservationsTableProps) {
  const url = useReservationsTableUrlState();
  const { filters, setFilter } = url;

  const filtered = useMemo(() => {
    return data.filter((row) => {
      if (filters.franchise !== ALL && row.franchise !== filters.franchise)
        return false;
      if (filters.status !== ALL && row.status !== filters.status) return false;
      if (!matchesCity(row, filters.city)) return false;
      if (
        filters.referral !== ALL &&
        (row.referrals?.id ?? row.referral_id ?? "") !== filters.referral
      )
        return false;
      if (!isWithinDateRange(row.created_at, filters.createdRange))
        return false;
      if (!isWithinDateRange(row.pickup_date, filters.pickupRange))
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
    onSortingChange: url.onSortingChange,
    onPaginationChange: url.onPaginationChange,
    autoResetPageIndex: false,
    initialState: {
      columnVisibility: { priority: false },
    },
    state: { sorting: url.sorting, pagination: url.pagination },
  });

  // Clamp pageIndex back to 0 when a stale bookmark or revalidatePath
  // leaves the operator on an out-of-range page (filtered.length > 0
  // but pageIndex >= pageCount). Without this the UI shows "Sin
  // resultados" against rows that exist on earlier pages.
  const pageCount = table.getPageCount();
  const { pageIndex, pageSize } = url.pagination;
  useEffect(() => {
    if (filtered.length > 0 && pageIndex >= pageCount) {
      url.onPaginationChange({ pageIndex: 0, pageSize });
    }
  }, [filtered.length, pageIndex, pageCount, pageSize, url]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Franquicia</label>
          <Select
            value={filters.franchise}
            onValueChange={(v) => setFilter("franchise", v)}
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
            onValueChange={(v) => setFilter("status", v)}
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
          <label className="text-xs text-muted-foreground">Ciudad</label>
          <Select
            value={filters.city}
            onValueChange={(v) => setFilter("city", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Ciudad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Creación</label>
          <DateRangePicker
            value={filters.createdRange}
            onChange={(range) => setFilter("createdRange", range)}
            placeholder="Creación"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Recogida</label>
          <DateRangePicker
            value={filters.pickupRange}
            onChange={(range) => setFilter("pickupRange", range)}
            placeholder="Recogida"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Referido</label>
          <Select
            value={filters.referral}
            onValueChange={(v) => setFilter("referral", v)}
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
            value={url.searchInput}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Nombre, ID, email, código…"
            className="min-w-[200px]"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={url.clearAll}
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
