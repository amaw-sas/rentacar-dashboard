"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { BookOpenIcon, PencilIcon } from "lucide-react";
import { ReturnLink } from "@/components/data-table/return-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableText } from "@/components/ui/copyable-text";
import { channelMeta } from "@/lib/attribution/channel-meta";
import type { AttributionChannel } from "@/lib/attribution/derive-channel";
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
  total_price_localiza: number;
  referral_id: string | null;
  referral_raw: string | null;
  attribution_channel: AttributionChannel | null;
  customer_name_at_booking?: string | null;
  customer_email_at_booking?: string | null;
  customer_phone_at_booking?: string | null;
  customer_identification_type_at_booking?: string | null;
  customer_identification_number_at_booking?: string | null;
  customers: {
    first_name: string;
    last_name: string;
    identification_number: string;
    phone: string;
    email: string;
  } | null;
  rental_companies: { name: string } | null;
  pickup_location: {
    name: string;
    city_id: string | null;
    cities: { id: string; name: string } | null;
  } | null;
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

// Pickup is a wall-clock date + hour with no zone (built locally below); these
// formatters carry no timeZone so the stored civil time is shown verbatim.
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

// created_at is a real instant (timestamptz). Pin the display to America/Bogota
// so the "Creado" column always matches the Colombia-anchored range filter
// (issue #115), regardless of the admin machine's timezone.
const createdDateFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
  timeZone: "America/Bogota",
});

const createdTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
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
      <div>{createdDateFormatter.format(d)}</div>
      <div className="text-muted-foreground">
        {createdTimeFormatter.format(d)}
      </div>
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
      row.customer_name_at_booking ??
      (row.customers
        ? `${row.customers.first_name} ${row.customers.last_name}`
        : ""),
    header: "Nombre",
    // Snapshot column with no order index: server-sorting it forced a full-table
    // heapsort (issue #104). Disabled — operators find names via the #102 trgm
    // search. Mirrors its removal from SORTABLE_COLUMNS in list-params.ts.
    enableSorting: false,
    cell: ({ row }) => {
      const c = row.original.customers;
      const fullName =
        row.original.customer_name_at_booking ??
        (c ? `${c.first_name} ${c.last_name}` : null);
      if (!fullName) return "—";
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
    accessorFn: (row) =>
      row.customer_identification_number_at_booking ??
      row.customers?.identification_number ??
      "",
    header: "ID",
    // Snapshot column, no order index → disabled server-sorting (issue #104).
    enableSorting: false,
    cell: ({ getValue }) => (
      <CopyableText value={getValue<string>()} label="ID" maxLength={ID_MAX} />
    ),
  },
  {
    id: "phone",
    accessorFn: (row) =>
      row.customer_phone_at_booking ?? row.customers?.phone ?? "",
    header: "Teléfono",
    // Snapshot column, no order index → disabled server-sorting (issue #104).
    enableSorting: false,
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
    accessorFn: (row) =>
      row.customer_email_at_booking ?? row.customers?.email ?? "",
    header: "Email",
    // Snapshot column, no order index → disabled server-sorting (issue #104).
    enableSorting: false,
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
    id: "origen",
    accessorKey: "attribution_channel",
    header: "Origen",
    // Server-sortable: column id "origen" maps to attribution_channel in
    // SORTABLE_COLUMNS. enableSorting defaults to true — do not disable.
    cell: ({ getValue }) => {
      const meta = channelMeta(getValue<AttributionChannel | null>());
      return <Badge variant={meta.variant}>{meta.label}</Badge>;
    },
  },
  {
    id: "referral",
    accessorFn: (row) => row.referrals?.name ?? row.referral_raw ?? "",
    header: "Referido",
    // Joined column: not server-sortable (no DB column in SORTABLE_COLUMNS).
    // Disable so the header shows no misleading sort arrow that the server
    // would silently ignore (falls back to created_at). Issue #100.
    enableSorting: false,
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
    // Computed expression (total_price + tax_fee): PostgREST can't ORDER BY it,
    // so it's absent from SORTABLE_COLUMNS. Disable sorting so the header
    // doesn't show an arrow the server silently ignores. Issue #100.
    enableSorting: false,
    cell: ({ getValue }) => currencyFormatter.format(getValue<number>()),
  },
  {
    id: "valor_oc",
    accessorKey: "total_price_localiza",
    header: "Valor OC",
    // total_price_localiza has no order index → server-sorting forced a
    // full-table heapsort (issue #104). Disabled; mirrors its removal from
    // SORTABLE_COLUMNS in list-params.ts.
    enableSorting: false,
    cell: ({ getValue }) => currencyFormatter.format(Number(getValue() ?? 0)),
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
          <ReturnLink
            href={`/reservations/${row.original.id}/edit`}
            aria-label="Editar"
          >
            <PencilIcon />
          </ReturnLink>
        </Button>
      </div>
    ),
  },
];
