"use client";

import { useEffect } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EraserIcon } from "lucide-react";

import { cn } from "@/lib/utils";
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
import { ALL } from "@/lib/reservations/list-params";
import {
  ATTRIBUTION_CHANNELS,
  UNKNOWN_FILTER,
  channelMeta,
} from "@/lib/attribution/channel-meta";
import { useReservationsTableUrlState } from "@/hooks/use-reservations-table-url-state";
import { columns, type ReservationRow } from "./columns";

type ReferralOption = { id: string; name: string };
type CityOption = { id: string; name: string };

interface ReservationsTableProps {
  // One server-rendered page of rows (already filtered, sorted, paginated).
  data: ReservationRow[];
  // Exact total of the filtered result set, for the count label + pagination.
  total: number;
  pageCount: number;
  referrals: ReferralOption[];
  cities: CityOption[];
}

export function ReservationsTable({
  data,
  total,
  pageCount,
  referrals,
  cities,
}: ReservationsTableProps) {
  const url = useReservationsTableUrlState();
  const { filters, setFilter } = url;

  // Filtering, sorting and pagination all run server-side now (issue #100).
  // The table is a pure renderer of the current page; manual* flags tell
  // @tanstack not to re-derive any row models client-side.
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    rowCount: total,
    onSortingChange: url.onSortingChange,
    onPaginationChange: url.onPaginationChange,
    autoResetPageIndex: false,
    initialState: {
      columnVisibility: { priority: false },
    },
    state: { sorting: url.sorting, pagination: url.pagination },
  });

  // If a stale bookmark or a shrunk result set leaves the operator past the
  // last page, the server returns an empty page. Clamp back to page 1 so they
  // see the rows that do exist instead of "Sin resultados".
  const { pageIndex, pageSize } = url.pagination;
  useEffect(() => {
    if (total > 0 && pageIndex >= pageCount) {
      url.onPaginationChange({ pageIndex: 0, pageSize });
    }
  }, [total, pageIndex, pageCount, pageSize, url]);

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
          <label className="text-xs text-muted-foreground">Origen</label>
          <Select
            value={filters.origen}
            onValueChange={(v) => setFilter("origen", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Origen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {ATTRIBUTION_CHANNELS.map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {channelMeta(channel).label}
                </SelectItem>
              ))}
              <SelectItem value={UNKNOWN_FILTER}>Desconocido</SelectItem>
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
                      asc: " ↑",
                      desc: " ↓",
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
        <p className="text-sm text-muted-foreground">{total} resultado(s)</p>
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
            {Math.max(pageCount, 1)}
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
