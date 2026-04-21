import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  STATUS_LABELS,
  type ReservationStatus,
} from "@/lib/schemas/reservation";

export type ReferralReservationRow = {
  id: string;
  created_at: string;
  reservation_code: string | null;
  status: string;
  franchise: string;
  pickup_date: string;
  pickup_hour: string;
  total_price: number | null;
  tax_fee: number | null;
  customer_name: string | null;
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

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function formatPickup(date: string, hour: string) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = (hour ?? "").split(":").map(Number);
  const combined = new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm);
  if (Number.isNaN(combined.getTime())) return date;
  return dateFormatter.format(combined);
}

export function ReferralReservationList({
  rows,
}: {
  rows: ReferralReservationRow[];
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Este referido no tiene reservas asociadas.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Historial de reservas</h2>
          <span className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "reserva" : "reservas"}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full caption-bottom text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  Recogida
                </th>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  Código
                </th>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  Estado
                </th>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  Cliente
                </th>
                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                  Franquicia
                </th>
                <th className="h-10 px-3 text-right align-middle font-medium text-muted-foreground">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {rows.map((r) => {
                const total =
                  Number(r.total_price ?? 0) + Number(r.tax_fee ?? 0);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border transition-colors hover:bg-muted/50"
                  >
                    <td className="px-3 py-2 align-middle">
                      <Link
                        href={`/reservations/${r.id}`}
                        className="hover:underline"
                      >
                        {formatPickup(r.pickup_date, r.pickup_hour)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 align-middle font-mono text-sm">
                      {r.reservation_code || "—"}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
                        {STATUS_LABELS[r.status as ReservationStatus] ?? r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {r.customer_name || "—"}
                    </td>
                    <td className="px-3 py-2 align-middle capitalize">
                      {r.franchise}
                    </td>
                    <td className="px-3 py-2 text-right align-middle">
                      {currencyFormatter.format(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
