import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/queries/customers";
import { getCustomerReservations } from "@/lib/queries/reservations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ReservationHistory,
  type HistoryRow,
} from "./reservation-history";

const identificationTypeLabels: Record<string, string> = {
  CC: "Cédula de Ciudadanía",
  CE: "Cédula de Extranjería",
  NIT: "NIT",
  PP: "Pasaporte",
  TI: "Tarjeta de Identidad",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let customer;
  try {
    customer = await getCustomer(id);
  } catch {
    notFound();
  }

  const reservations = await getCustomerReservations(id).catch(() => []);
  const historyRows: HistoryRow[] = reservations.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    reservation_code: r.reservation_code,
    status: r.status,
    franchise: r.franchise,
    pickup_date: r.pickup_date,
    pickup_hour: r.pickup_hour,
    total_price: r.total_price,
    tax_fee: r.tax_fee,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {customer.first_name} {customer.last_name}
          </h1>
          <Badge variant={customer.status === "active" ? "default" : "secondary"}>
            {customer.status === "active" ? "Activo" : "Inactivo"}
          </Badge>
        </div>
        <Button asChild>
          <Link href={`/customers/${id}/edit`}>Editar</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Nombre</p>
            <p className="font-medium">{customer.first_name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Apellido</p>
            <p className="font-medium">{customer.last_name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Tipo de identificación</p>
            <p className="font-medium">
              {identificationTypeLabels[customer.identification_type] ??
                customer.identification_type}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Número de identificación</p>
            <p className="font-medium">{customer.identification_number}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Teléfono</p>
            <p className="font-medium">{customer.phone || "—"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="font-medium">{customer.email}</p>
          </div>
          {customer.notes && (
            <div className="sm:col-span-2">
              <p className="text-sm text-muted-foreground">Notas</p>
              <p className="font-medium whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <ReservationHistory rows={historyRows} />
    </div>
  );
}
