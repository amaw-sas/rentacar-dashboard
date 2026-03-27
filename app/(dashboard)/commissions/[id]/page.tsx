import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommission } from "@/lib/queries/commissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  MATCH_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/schemas/commission";
import { CommissionLinkForm } from "@/components/forms/commission-link-form";
import { CommissionDetailActions } from "./detail-actions";

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

export default async function CommissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let commission;
  try {
    commission = await getCommission(id);
  } catch {
    notFound();
  }

  const reservation = commission.reservations;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Detalle de comision</h1>
        <Button variant="outline" asChild>
          <Link href="/commissions">Volver a comisiones</Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Raw data */}
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Datos del Excel</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Cliente</dt>
            <dd>{commission.customer_name_raw}</dd>

            <dt className="text-muted-foreground">Codigo reserva</dt>
            <dd className="font-mono">{commission.reservation_code_raw}</dd>

            <dt className="text-muted-foreground">Valor reserva</dt>
            <dd>{copFormat.format(commission.reservation_value)}</dd>

            <dt className="text-muted-foreground">Comision</dt>
            <dd>{copFormat.format(commission.commission_amount)}</dd>

            <dt className="text-muted-foreground">Tasa</dt>
            <dd>
              {commission.commission_rate != null
                ? `${commission.commission_rate}%`
                : "—"}
            </dd>

            <dt className="text-muted-foreground">Tipo contrato</dt>
            <dd>{commission.contract_type ?? "—"}</dd>

            <dt className="text-muted-foreground">Valor real</dt>
            <dd>
              {commission.real_value != null
                ? copFormat.format(commission.real_value)
                : "—"}
            </dd>

            <dt className="text-muted-foreground">Mes comision</dt>
            <dd>{commission.commission_month ?? "—"}</dd>
          </dl>
        </Card>

        {/* Status and reservation */}
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-semibold">Estado</h2>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Vinculacion:</span>
            <Badge
              variant={
                matchStatusColors[commission.match_status] as
                  | "default"
                  | "destructive"
                  | "secondary"
                  | "outline"
              }
            >
              {
                MATCH_STATUS_LABELS[
                  commission.match_status as keyof typeof MATCH_STATUS_LABELS
                ]
              }
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Pago:</span>
            <Badge
              variant={
                paymentStatusColors[commission.payment_status] as
                  | "default"
                  | "destructive"
                  | "secondary"
                  | "outline"
              }
            >
              {
                PAYMENT_STATUS_LABELS[
                  commission.payment_status as keyof typeof PAYMENT_STATUS_LABELS
                ]
              }
            </Badge>
          </div>

          {reservation ? (
            <div className="space-y-2 rounded-md border p-3">
              <h3 className="text-sm font-semibold">Reserva vinculada</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Codigo</dt>
                <dd className="font-mono">
                  {reservation.reservation_code ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Estado</dt>
                <dd>{reservation.status}</dd>
                <dt className="text-muted-foreground">Valor total</dt>
                <dd>{copFormat.format(reservation.total_price)}</dd>
                <dt className="text-muted-foreground">Cliente</dt>
                <dd>
                  {reservation.customers
                    ? `${reservation.customers.first_name} ${reservation.customers.last_name}`
                    : "—"}
                </dd>
              </dl>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Esta comision no esta vinculada a ninguna reserva.
              </p>
              <CommissionLinkForm commissionId={commission.id} />
            </div>
          )}
        </Card>
      </div>

      {/* Actions: payment status + notes */}
      <CommissionDetailActions commission={commission} />
    </div>
  );
}
