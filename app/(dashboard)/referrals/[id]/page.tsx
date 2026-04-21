import Link from "next/link";
import { notFound } from "next/navigation";
import { getReferral } from "@/lib/queries/referrals";
import { getReferralReservations } from "@/lib/queries/reservations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ReferralReservationList,
  type ReferralReservationRow,
} from "./reservation-list";

const typeLabels: Record<string, string> = {
  company: "Empresa",
  hotel: "Hotel",
  salesperson: "Vendedor",
  other: "Otro",
};

export default async function ReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let referral;
  try {
    referral = await getReferral(id);
  } catch {
    notFound();
  }

  const reservations = await getReferralReservations(id).catch(() => []);
  const rows: ReferralReservationRow[] = reservations.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    reservation_code: r.reservation_code,
    status: r.status,
    franchise: r.franchise,
    pickup_date: r.pickup_date,
    pickup_hour: r.pickup_hour,
    total_price: r.total_price,
    tax_fee: r.tax_fee,
    customer_name: r.customers
      ? `${r.customers.first_name} ${r.customers.last_name}`.trim()
      : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{referral.name}</h1>
          <Badge variant="outline">
            {typeLabels[referral.type] ?? referral.type}
          </Badge>
          <Badge
            variant={referral.status === "active" ? "default" : "secondary"}
          >
            {referral.status === "active" ? "Activo" : "Inactivo"}
          </Badge>
        </div>
        <Button asChild>
          <Link href={`/referrals/${id}/edit`}>Editar</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Código</p>
            <p className="font-medium font-mono">{referral.code}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Contacto</p>
            <p className="font-medium">{referral.contact_name || "—"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Email de contacto</p>
            <p className="font-medium">{referral.contact_email || "—"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Teléfono de contacto</p>
            <p className="font-medium">{referral.contact_phone || "—"}</p>
          </div>
          {referral.commission_notes && (
            <div className="sm:col-span-2">
              <p className="text-sm text-muted-foreground">Notas de comisión</p>
              <p className="font-medium whitespace-pre-wrap">
                {referral.commission_notes}
              </p>
            </div>
          )}
          {referral.notes && (
            <div className="sm:col-span-2">
              <p className="text-sm text-muted-foreground">Notas</p>
              <p className="font-medium whitespace-pre-wrap">
                {referral.notes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <ReferralReservationList rows={rows} />
    </div>
  );
}
