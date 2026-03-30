"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type FranchiseRow = {
  id: string;
  display_name: string;
  code: string;
  sender_email: string;
  phone: string;
  status: string;
};

export const columns: ColumnDef<FranchiseRow, unknown>[] = [
  {
    accessorKey: "display_name",
    header: "Nombre",
  },
  {
    accessorKey: "code",
    header: "Código",
  },
  {
    accessorKey: "sender_email",
    header: "Email Remitente",
  },
  {
    accessorKey: "phone",
    header: "Teléfono",
    cell: ({ getValue }) => {
      const phone = getValue<string>();
      return phone || "—";
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
        <Link href={`/franchises/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
