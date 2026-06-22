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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL,
  CHAT_BRANDS,
  CHAT_STATUSES,
  CHAT_STATUS_LABELS,
  REVIEW_LABEL_OPTIONS,
  REVIEW_LABELS,
  UNREVIEWED,
} from "@/lib/chat/list-params";
import { useConversationsTableUrlState } from "@/hooks/use-conversations-table-url-state";
import { columns, type ConversationRow } from "./columns";

type CityOption = { value: string; label: string };

interface ConversationsTableProps {
  data: ConversationRow[];
  total: number;
  pageCount: number;
  cities: CityOption[];
}

export function ConversationsTable({
  data,
  total,
  pageCount,
  cities,
}: ConversationsTableProps) {
  const url = useConversationsTableUrlState();
  const { filters, setFilter } = url;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableSortingRemoval: false,
    sortDescFirst: true,
    pageCount,
    rowCount: total,
    onSortingChange: url.onSortingChange,
    onPaginationChange: url.onPaginationChange,
    autoResetPageIndex: false,
    state: { sorting: url.sorting, pagination: url.pagination },
  });

  // Clamp back to page 1 if a stale bookmark leaves the operator past the last
  // page (server returns an empty page otherwise).
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
          <label className="text-xs text-muted-foreground">Marca</label>
          <Select
            value={filters.brand}
            onValueChange={(v) => setFilter("brand", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Marca" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {CHAT_BRANDS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
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
              {CHAT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {CHAT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Revisión</label>
          <Select
            value={filters.review}
            onValueChange={(v) => setFilter("review", v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Revisión" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {REVIEW_LABELS.map((r) => (
                <SelectItem key={r} value={r}>
                  {REVIEW_LABEL_OPTIONS[r]}
                </SelectItem>
              ))}
              <SelectItem value={UNREVIEWED}>
                {REVIEW_LABEL_OPTIONS[UNREVIEWED]}
              </SelectItem>
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
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
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
                      header.column.getCanSort() && "cursor-pointer select-none",
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
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border transition-colors hover:bg-muted/50"
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
              ))
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
