import Link from "next/link";
import { notFound } from "next/navigation";
import { getReservation } from "@/lib/queries/reservations";
import { getNotificationLogs } from "@/lib/queries/notification-logs";
import { NotificationLogTimeline } from "@/components/layout/notification-log-timeline";
import { BOOKING_TYPE_LABELS, type ReservationStatus } from "@/lib/schemas/reservation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReservationStatusActions } from "@/components/layout/reservation-status-actions";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}

function BoolField({ label, value }: { label: string; value: boolean }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value ? "Si" : "No"}</p>
    </div>
  );
}

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let reservation;
  try {
    reservation = await getReservation(id);
  } catch {
    notFound();
  }

  const notificationLogs = await getNotificationLogs(id);

  const customerName = reservation.customers
    ? `${reservation.customers.first_name} ${reservation.customers.last_name}`
    : "—";

  const bookingTypeLabel =
    BOOKING_TYPE_LABELS[
      reservation.booking_type as keyof typeof BOOKING_TYPE_LABELS
    ] ?? reservation.booking_type;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reserva {reservation.reservation_code ?? id.slice(0, 8)}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/reservations">Volver</Link>
          </Button>
          <Button asChild>
            <Link href={`/reservations/${id}/edit`}>Editar</Link>
          </Button>
        </div>
      </div>

      {/* Status */}
      <Card>
        <CardHeader>
          <CardTitle>Estado</CardTitle>
        </CardHeader>
        <CardContent>
          <ReservationStatusActions
            reservationId={id}
            currentStatus={reservation.status as ReservationStatus}
          />
        </CardContent>
      </Card>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Franquicia" value={reservation.franchise} />
          <Field label="Tipo de Reserva" value={bookingTypeLabel} />
          <Field label="Código de Reserva" value={reservation.reservation_code} />
          <Field label="Rentadora" value={reservation.rental_companies?.name} />
        </CardContent>
      </Card>

      {/* Cliente */}
      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Nombre"
            value={
              <Link
                href={`/customers/${reservation.customer_id}`}
                className="hover:underline"
              >
                {customerName}
              </Link>
            }
          />
          <Field label="Referido" value={reservation.referrals ? `${reservation.referrals.name} (${reservation.referrals.code})` : reservation.referral_raw ?? "—"} />
        </CardContent>
      </Card>

      {/* Booking */}
      <Card>
        <CardHeader>
          <CardTitle>Reserva</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Categoría" value={reservation.category_code} />
          <Field label="Ubicación Recogida" value={reservation.pickup_location?.name} />
          <Field label="Ubicación Devolución" value={reservation.return_location?.name} />
          <Field label="Fecha Recogida" value={reservation.pickup_date} />
          <Field label="Hora Recogida" value={reservation.pickup_hour} />
          <Field label="Fecha Devolución" value={reservation.return_date} />
          <Field label="Hora Devolución" value={reservation.return_hour} />
          <Field label="Días Seleccionados" value={reservation.selected_days} />
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Precios</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Precio Total" value={`$${reservation.total_price}`} />
          <Field label="Total a Pagar" value={`$${reservation.total_price_to_pay}`} />
          <Field label="Precio Localiza" value={`$${reservation.total_price_localiza}`} />
          <Field label="Impuestos" value={`$${reservation.tax_fee}`} />
          <Field label="IVA" value={`$${reservation.iva_fee}`} />
          <Field label="Días Cobertura" value={reservation.coverage_days} />
          <Field label="Precio Cobertura" value={`$${reservation.coverage_price}`} />
        </CardContent>
      </Card>

      {/* Extras */}
      <Card>
        <CardHeader>
          <CardTitle>Extras</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Cargo Devolución" value={`$${reservation.return_fee}`} />
          <Field label="Horas Extra" value={reservation.extra_hours} />
          <Field label="Precio Horas Extra" value={`$${reservation.extra_hours_price}`} />
          <Field label="Seguro Total" value={`$${reservation.total_insurance}`} />
          <BoolField label="Conductor Adicional" value={reservation.extra_driver} />
          <BoolField label="Silla de Bebé" value={reservation.baby_seat} />
          <BoolField label="Lavado" value={reservation.wash} />
        </CardContent>
      </Card>

      {/* Flight */}
      {(reservation.aeroline || reservation.flight_number) && (
        <Card>
          <CardHeader>
            <CardTitle>Vuelo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <Field label="Aerolínea" value={reservation.aeroline} />
            <Field label="Número de Vuelo" value={reservation.flight_number} />
          </CardContent>
        </Card>
      )}

      {/* Monthly */}
      {reservation.booking_type === "monthly" && (
        <Card>
          <CardHeader>
            <CardTitle>Mensualidad</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Kilometraje Mensual" value={reservation.monthly_mileage} />
          </CardContent>
        </Card>
      )}

      {/* Nota */}
      <Card>
        <CardHeader>
          <CardTitle>Nota</CardTitle>
        </CardHeader>
        <CardContent>
          {reservation.nota ? (
            <p className="whitespace-pre-wrap text-sm">{reservation.nota}</p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </CardContent>
      </Card>

      {/* Notification History */}
      <NotificationLogTimeline logs={notificationLogs} />
    </div>
  );
}
