"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  identification_type: string;
  identification_number: string;
  phone: string;
  email: string;
  status: string;
};

export const columns: ColumnDef<CustomerRow, unknown>[] = [
  {
    id: "full_name",
    accessorFn: (row) => `${row.first_name} ${row.last_name}`,
    header: "Nombre",
    cell: ({ row }) => (
      <Link
        href={`/customers/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.first_name} {row.original.last_name}
      </Link>
    ),
  },
  {
    id: "identification",
    header: "Identificación",
    cell: ({ row }) =>
      `${row.original.identification_type} ${row.original.identification_number}`,
  },
  {
    accessorKey: "phone",
    header: "Teléfono",
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status === "active" ? "Activo" : "Inactivo"}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/customers/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
