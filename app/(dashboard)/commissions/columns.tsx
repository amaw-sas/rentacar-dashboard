"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MATCH_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/schemas/commission";

export type CommissionRow = {
  id: string;
  customer_name_raw: string;
  reservation_code_raw: string;
  reservation_value: number;
  commission_amount: number;
  commission_rate: number | null;
  match_status: "matched" | "unmatched" | "manual";
  payment_status: "pending" | "invoiced" | "paid";
  reservations: {
    id: string;
    reservation_code: string;
  } | null;
};

const copFormat = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
});

const matchStatusColors: Record<string, string> = {
  matched: "default",
  unmatched: "destructive",
  manual: "secondary",
};

const paymentStatusColors: Record<string, string> = {
  pending: "secondary",
  invoiced: "outline",
  paid: "default",
};

export const columns: ColumnDef<CommissionRow, unknown>[] = [
  {
    accessorKey: "customer_name_raw",
    header: "Cliente",
  },
  {
    accessorKey: "reservation_code_raw",
    header: "Reserva",
  },
  {
    accessorKey: "reservation_value",
    header: "Valor reserva",
    cell: ({ getValue }) => copFormat.format(getValue<number>()),
  },
  {
    accessorKey: "commission_amount",
    header: "Comision",
    cell: ({ getValue }) => copFormat.format(getValue<number>()),
  },
  {
    accessorKey: "commission_rate",
    header: "Tasa %",
    cell: ({ getValue }) => {
      const rate = getValue<number | null>();
      return rate != null ? `${rate}%` : "—";
    },
  },
  {
    accessorKey: "match_status",
    header: "Vinculacion",
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge
          variant={
            matchStatusColors[status] as
              | "default"
              | "destructive"
              | "secondary"
              | "outline"
          }
        >
          {MATCH_STATUS_LABELS[status as keyof typeof MATCH_STATUS_LABELS]}
        </Badge>
      );
    },
  },
  {
    accessorKey: "payment_status",
    header: "Pago",
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge
          variant={
            paymentStatusColors[status] as
              | "default"
              | "destructive"
              | "secondary"
              | "outline"
          }
        >
          {PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS]}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/commissions/${row.original.id}`}>Ver</Link>
      </Button>
    ),
  },
];
