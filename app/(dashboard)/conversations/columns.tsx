"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CHAT_STATUS_LABELS } from "@/lib/chat/list-params";

export type ConversationRow = {
  id: string;
  brand: string;
  city_detected: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  review_label: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  chat_messages: { count: number }[];
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "secondary",
  closed: "outline",
  handoff: "destructive",
};

const REVIEW_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  good: "default",
  bad: "destructive",
};

const REVIEW_LABEL_TEXT: Record<string, string> = {
  good: "Buena",
  bad: "Mala",
};

// created_at is a real instant (timestamptz). Pin the display to America/Bogota
// so the "Creada" column matches the Colombia-anchored range filter.
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

function messageCount(row: ConversationRow): number {
  return row.chat_messages?.[0]?.count ?? 0;
}

export const columns: ColumnDef<ConversationRow, unknown>[] = [
  {
    accessorKey: "created_at",
    header: "Creada",
    cell: ({ row }) => (
      <Link
        href={`/conversations/${row.original.id}`}
        className="font-medium hover:underline"
      >
        {renderDateTimeStack(row.original.created_at)}
      </Link>
    ),
  },
  {
    accessorKey: "brand",
    header: "Marca",
    enableSorting: false,
    cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge>,
  },
  {
    id: "city",
    accessorFn: (row) => row.city_detected ?? "",
    header: "Ciudad",
    enableSorting: false,
    cell: ({ row }) => row.original.city_detected || "—",
  },
  {
    accessorKey: "status",
    header: "Estado",
    enableSorting: false,
    cell: ({ getValue }) => {
      const status = getValue<string>();
      return (
        <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
          {CHAT_STATUS_LABELS[status] ?? status}
        </Badge>
      );
    },
  },
  {
    id: "messages",
    accessorFn: (row) => messageCount(row),
    header: "Mensajes",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="tabular-nums">{messageCount(row.original)}</span>
    ),
  },
  {
    id: "review",
    accessorFn: (row) => row.review_label ?? "",
    header: "Revisión",
    enableSorting: false,
    cell: ({ row }) => {
      const label = row.original.review_label;
      if (!label)
        return <span className="text-muted-foreground">Sin revisar</span>;
      return (
        <Badge variant={REVIEW_VARIANT[label] ?? "secondary"}>
          {REVIEW_LABEL_TEXT[label] ?? label}
        </Badge>
      );
    },
  },
];
