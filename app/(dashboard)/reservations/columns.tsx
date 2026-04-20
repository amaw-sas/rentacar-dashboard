"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { BookOpenIcon, PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableText } from "@/components/ui/copyable-text";
import {
  STATUS_LABELS,
  isPriorityStatus,
  type ReservationStatus,
} from "@/lib/schemas/reservation";

export type ReservationRow = {
  id: string;
  franchise: string;
  booking_type: string;
  category_code: string;
  pickup_date: string;
  pickup_hour: string;
  created_at: string;
  status: string;
  reservation_code: string | null;
  total_price: number;
  tax_fee: number;
  referral_id: string | null;
  referral_raw: string | null;
  customers: {
    first_name: string;
    last_name: string;
    identification_number: string;
    phone: string;
    email: string;
  } | null;
  rental_companies: { name: string } | null;
  pickup_location: { name: string } | null;
  return_location: { name: string } | null;
  referrals: { id: string; name: string; code: string } | null;
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
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

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const NAME_MAX = 20;
const ID_MAX = 15;
const PHONE_MAX = 15;
const EMAIL_MAX = 20;

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function renderDateTimeStack(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    <div className="leading-tight">
      <div>{dateFormatter.format(d)}</div>
      <div className="text-muted-foreground">{timeFormatter.format(d)}</div>
    </div>
  );
}

function renderPickup(date: string, hour: string) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = (hour ?? "").split(":").map(Number);
  const combined = new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm);
  if (Number.isNaN(combined.getTime())) return date;
  return (
    <div className="leading-tight">
      <div>{dateFormatter.format(combined)}</div>
      <div className="text-muted-foreground">
        {timeFormatter.format(combined)}
      </div>
    </div>
  );
}

export const columns: ColumnDef<ReservationRow, unknown>[] = [
  {
    id: "priority",
    accessorFn: (row) => (isPriorityStatus(row.status) ? 0 : 1),
    enableHiding: true,
    enableColumnFilter: false,
  },
  {
    accessorKey: "created_at",
    header: "Creado",
    cell: ({ getValue }) => renderDateTimeStack(getValue<string>()),
  },
  {
    id: "customer",
    accessorFn: (row) =>
      row.customers
        ? `${row.customers.first_name} ${row.customers.last_name}`
        : "",
    header: "Nombre",
    cell: ({ row }) => {
      const c = row.original.customers;
      if (!c) return "—";
      const fullName = `${c.first_name} ${c.last_name}`;
      return (
        <Link
          href={`/reservations/${row.original.id}`}
          className="font-medium hover:underline"
          title={fullName}
        >
          {truncate(fullName, NAME_MAX)}
        </Link>
      );
    },
  },
  {
    id: "identification",
    accessorFn: (row) => row.customers?.identification_number ?? "",
    header: "ID",
    cell: ({ getValue }) => (
      <CopyableText value={getValue<string>()} label="ID" maxLength={ID_MAX} />
    ),
  },
  {
    id: "phone",
    accessorFn: (row) => row.customers?.phone ?? "",
    header: "Teléfono",
    cell: ({ getValue }) => (
      <CopyableText
        value={getValue<string>()}
        label="teléfono"
        maxLength={PHONE_MAX}
      />
    ),
  },
  {
    id: "email",
    accessorFn: (row) => row.customers?.email ?? "",
    header: "Email",
    cell: ({ getValue }) => (
      <CopyableText
        value={getValue<string>()}
        label="email"
        maxLength={EMAIL_MAX}
      />
    ),
  },
  {
    id: "pickup",
    accessorKey: "pickup_date",
    header: "Recogida",
    cell: ({ row }) =>
      renderPickup(row.original.pickup_date, row.original.pickup_hour),
  },
  {
    accessorKey: "reservation_code",
    header: "Código",
    cell: ({ getValue }) => (
      <CopyableText value={getValue<string>()} label="código" />
    ),
  },
  {
    accessorKey: "category_code",
    header: "Cat.",
  },
  {
    accessorKey: "franchise",
    header: "Franquicia",
    cell: ({ getValue }) => (
      <Badge variant="outline">{getValue<string>()}</Badge>
    ),
  },
  {
    id: "referral",
    accessorFn: (row) => row.referrals?.name ?? row.referral_raw ?? "",
    header: "Referido",
    cell: ({ getValue }) => getValue<string>() || "—",
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
    id: "total_with_tax",
    accessorFn: (row) =>
      Number(row.total_price ?? 0) + Number(row.tax_fee ?? 0),
    header: "Total + Tax",
    cell: ({ getValue }) => currencyFormatter.format(getValue<number>()),
  },
  {
    id: "valor_oc",
    header: "Valor OC",
    enableSorting: false,
    cell: () => <span className="text-muted-foreground">—</span>,
  },
  {
    id: "actions",
    header: "Operaciones",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        {row.original.reservation_code ? (
          <Button variant="ghost" size="icon-xs" asChild>
            <Link
              href={`/reservations/${row.original.id}/libro`}
              target="_blank"
              rel="noopener"
              aria-label="Libro"
            >
              <BookOpenIcon />
            </Link>
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-xs" asChild>
          <Link
            href={`/reservations/${row.original.id}/edit`}
            aria-label="Editar"
          >
            <PencilIcon />
          </Link>
        </Button>
      </div>
    ),
  },
];
