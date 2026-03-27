"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type LocationRow = {
  id: string;
  name: string;
  code: string;
  city: string;
  status: string;
  rental_companies: { name: string } | null;
};

export const columns: ColumnDef<LocationRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
  },
  {
    accessorKey: "code",
    header: "Código",
  },
  {
    accessorKey: "city",
    header: "Ciudad",
  },
  {
    id: "rental_company",
    header: "Rentadora",
    cell: ({ row }) => row.original.rental_companies?.name ?? "—",
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
        <Link href={`/locations/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
