"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export type CommissionImportRow = {
  id: string;
  file_name: string;
  period_label: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  total_commission: number;
  imported_at: string;
  rental_companies: { name: string } | null;
};

const copFormat = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const columns: ColumnDef<CommissionImportRow, unknown>[] = [
  {
    accessorKey: "file_name",
    header: "Archivo",
  },
  {
    id: "rental_company",
    header: "Rentadora",
    cell: ({ row }) => row.original.rental_companies?.name ?? "—",
  },
  {
    accessorKey: "period_label",
    header: "Periodo",
    cell: ({ getValue }) => getValue<string | null>() ?? "—",
  },
  {
    accessorKey: "total_rows",
    header: "Total",
  },
  {
    accessorKey: "matched_rows",
    header: "Vinculadas",
  },
  {
    accessorKey: "unmatched_rows",
    header: "Sin vincular",
  },
  {
    accessorKey: "total_commission",
    header: "Total comision",
    cell: ({ getValue }) => copFormat.format(getValue<number>()),
  },
  {
    accessorKey: "imported_at",
    header: "Importado",
    cell: ({ getValue }) => dateFormat.format(new Date(getValue<string>())),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link
          href={`/commissions?import_batch_id=${row.original.id}`}
        >
          Ver comisiones
        </Link>
      </Button>
    ),
  },
];
