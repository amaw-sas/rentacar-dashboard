"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CityRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export const columns: ColumnDef<CityRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
    cell: ({ row }) => (
      <Link
        href={`/cities/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "slug",
    header: "Slug",
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
        <Link href={`/cities/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
