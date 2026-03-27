"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type RentalCompanyRow = {
  id: string;
  name: string;
  code: string;
  commission_rate_min: number | null;
  commission_rate_max: number | null;
  status: string;
};

export const columns: ColumnDef<RentalCompanyRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
  },
  {
    accessorKey: "code",
    header: "Código",
  },
  {
    id: "commission",
    header: "Comisión",
    cell: ({ row }) => {
      const min = row.original.commission_rate_min;
      const max = row.original.commission_rate_max;

      if (min == null && max == null) return "—";
      if (min != null && max != null) return `${min}% - ${max}%`;
      if (min != null) return `${min}%`;
      return `${max}%`;
    },
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status === "active" ? "Activa" : "Inactiva"}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/rental-companies/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
