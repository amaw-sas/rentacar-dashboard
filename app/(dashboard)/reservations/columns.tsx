"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  STATUS_LABELS,
  BOOKING_TYPE_LABELS,
  type ReservationStatus,
} from "@/lib/schemas/reservation";

export type ReservationRow = {
  id: string;
  franchise: string;
  booking_type: string;
  category_code: string;
  pickup_date: string;
  status: string;
  reservation_code: string | null;
  customers: { first_name: string; last_name: string } | null;
  rental_companies: { name: string } | null;
  pickup_location: { name: string } | null;
  return_location: { name: string } | null;
  referrals: { name: string; code: string } | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  nueva: "outline",
  pendiente: "secondary",
  reservado: "default",
  sin_disponibilidad: "secondary",
  utilizado: "default",
  no_contactado: "secondary",
  baneado: "destructive",
  no_recogido: "destructive",
  pendiente_pago: "secondary",
  pendiente_modificar: "secondary",
  cancelado: "destructive",
  indeterminado: "outline",
  mensualidad: "default",
};

export const columns: ColumnDef<ReservationRow, unknown>[] = [
  {
    id: "customer",
    accessorFn: (row) =>
      row.customers
        ? `${row.customers.first_name} ${row.customers.last_name}`
        : "—",
    header: "Cliente",
    cell: ({ row }) => {
      const c = row.original.customers;
      if (!c) return "—";
      return (
        <Link
          href={`/reservations/${row.original.id}`}
          className="font-medium hover:underline"
        >
          {c.first_name} {c.last_name}
        </Link>
      );
    },
  },
  {
    accessorKey: "franchise",
    header: "Franquicia",
    cell: ({ getValue }) => (
      <Badge variant="outline">{getValue<string>()}</Badge>
    ),
  },
  {
    accessorKey: "booking_type",
    header: "Tipo",
    cell: ({ getValue }) => {
      const value = getValue<string>();
      return (
        BOOKING_TYPE_LABELS[value as keyof typeof BOOKING_TYPE_LABELS] ?? value
      );
    },
  },
  {
    accessorKey: "category_code",
    header: "Categoría",
  },
  {
    accessorKey: "pickup_date",
    header: "Fecha Recogida",
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
          {STATUS_LABELS[status as ReservationStatus] ?? status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "reservation_code",
    header: "Código",
    cell: ({ getValue }) => getValue<string>() ?? "—",
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/reservations/${row.original.id}`}>Ver</Link>
      </Button>
    ),
  },
];
