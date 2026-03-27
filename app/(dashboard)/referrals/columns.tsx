"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const typeLabels: Record<string, string> = {
  company: "Empresa",
  hotel: "Hotel",
  salesperson: "Vendedor",
  other: "Otro",
};

export type ReferralRow = {
  id: string;
  name: string;
  code: string;
  type: string;
  contact_name: string;
  status: string;
};

export const columns: ColumnDef<ReferralRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
  },
  {
    accessorKey: "code",
    header: "Código",
  },
  {
    accessorKey: "type",
    header: "Tipo",
    cell: ({ getValue }) => {
      const type = getValue<string>();
      return (
        <Badge variant="outline">
          {typeLabels[type] ?? type}
        </Badge>
      );
    },
  },
  {
    accessorKey: "contact_name",
    header: "Contacto",
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
        <Link href={`/referrals/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
