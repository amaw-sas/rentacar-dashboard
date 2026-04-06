import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { GhlConfig } from "./config";
import { getStageId, getOpportunityStatus } from "./config";
import type { ReservationStatus } from "@/lib/schemas/reservation";

interface ReservationData {
  status: ReservationStatus;
  category_code: string;
  total_price: number;
  reservation_code: string | null;
  pickup_date: string;
  pickup_hour: string;
  return_date: string;
  return_hour: string;
  customers: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  pickup_location: { name: string } | null;
  return_location: { name: string } | null;
  ghl_contact_id: string | null;
}

function cleanPhone(phone: string): string {
  return phone.replace(/[\s+\-()]/g, "");
}

function formatDateTime(dateStr: string, hourStr: string): string {
  return format(
    new Date(`${dateStr}T${hourStr}`),
    "d 'de' MMMM yyyy, h:mm a",
    { locale: es }
  );
}

export function mapReservationToContact(
  reservation: ReservationData,
  locationId: string
) {
  const customer = reservation.customers;
  return {
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: cleanPhone(customer.phone),
    locationId,
    source: "Reserva Web",
  };
}

export function mapReservationToOpportunity(
  reservation: ReservationData,
  config: GhlConfig
) {
  const status = reservation.status;
  const customer = reservation.customers;
  const customerName = `${customer.first_name} ${customer.last_name}`;
  const pickupCity = reservation.pickup_location?.name ?? "";
  const returnCity = reservation.return_location?.name ?? "";

  const stageId = getStageId(config, status);

  return {
    pipelineId: config.pipeline_id,
    ...(stageId && { pipelineStageId: stageId }),
    name: `${reservation.category_code} - ${customerName}`,
    status: getOpportunityStatus(status),
    monetaryValue: reservation.total_price,
    contactId: reservation.ghl_contact_id!,
    customFields: [
      { key: "ciudad_de_recogida", field_value: pickupCity },
      { key: "ciudad_de_entrega", field_value: returnCity },
      {
        key: "fecha_hora_recogida",
        field_value: formatDateTime(
          reservation.pickup_date,
          reservation.pickup_hour
        ),
      },
      {
        key: "fecha_hora_entrega",
        field_value: formatDateTime(
          reservation.return_date,
          reservation.return_hour
        ),
      },
      {
        key: "codigo_de_reserva",
        field_value: reservation.reservation_code ?? "",
      },
      { key: "gama", field_value: reservation.category_code },
    ],
  };
}
