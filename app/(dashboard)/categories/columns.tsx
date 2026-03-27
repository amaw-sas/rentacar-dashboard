"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type VehicleCategoryRow = {
  id: string;
  name: string;
  code: string;
  passenger_count: number;
  luggage_count: number;
  transmission: string;
  has_ac: boolean;
  status: string;
  rental_companies: { name: string } | null;
};

export const columns: ColumnDef<VehicleCategoryRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
    cell: ({ row }) => (
      <Link
        href={`/categories/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Código",
  },
  {
    accessorKey: "passenger_count",
    header: "Pasajeros",
  },
  {
    accessorKey: "luggage_count",
    header: "Equipaje",
  },
  {
    accessorKey: "transmission",
    header: "Transmisión",
    cell: ({ getValue }) => {
      const transmission = getValue<string>();
      return (
        <Badge variant={transmission === "automatic" ? "default" : "secondary"}>
          {transmission === "automatic" ? "Automática" : "Manual"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "has_ac",
    header: "A/C",
    cell: ({ getValue }) => (getValue<boolean>() ? "Sí" : "No"),
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
        <Link href={`/categories/${row.original.id}/edit`}>Editar</Link>
      </Button>
    ),
  },
];
