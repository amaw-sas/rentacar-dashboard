import { z } from "zod";

export const RESERVATION_STATUSES = [
  "nueva",
  "pendiente",
  "reservado",
  "sin_disponibilidad",
  "utilizado",
  "no_contactado",
  "baneado",
  "no_recogido",
  "pendiente_pago",
  "pendiente_modificar",
  "cancelado",
  "indeterminado",
  "mensualidad",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PRIORITY_STATUSES: readonly ReservationStatus[] = [
  "pendiente",
  "pendiente_modificar",
  "mensualidad",
  "pendiente_pago",
] as const;

export function isPriorityStatus(status: string): boolean {
  return (PRIORITY_STATUSES as readonly string[]).includes(status);
}

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  nueva: "Nueva",
  pendiente: "Pendiente",
  reservado: "Reservado",
  sin_disponibilidad: "Sin Disponibilidad",
  utilizado: "Utilizado",
  no_contactado: "No Contactado",
  baneado: "Baneado",
  no_recogido: "No Recogido",
  pendiente_pago: "Pendiente Pago",
  pendiente_modificar: "Pendiente Modificar",
  cancelado: "Cancelado",
  indeterminado: "Indeterminado",
  mensualidad: "Mensualidad",
};

export const VALID_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  nueva: ["pendiente", "reservado", "sin_disponibilidad", "mensualidad", "cancelado"],
  pendiente: ["reservado", "sin_disponibilidad", "indeterminado", "cancelado"],
  reservado: ["utilizado", "no_recogido", "cancelado", "pendiente_modificar"],
  sin_disponibilidad: ["nueva", "cancelado"],
  utilizado: ["cancelado"],
  no_contactado: ["cancelado"],
  baneado: ["cancelado"],
  no_recogido: ["cancelado"],
  pendiente_pago: ["reservado", "cancelado"],
  pendiente_modificar: ["reservado", "cancelado"],
  cancelado: [],
  indeterminado: ["reservado", "sin_disponibilidad", "cancelado"],
  mensualidad: ["reservado", "sin_disponibilidad", "cancelado", "utilizado"],
};

export const FRANCHISES = ["alquilatucarro", "alquilame", "alquicarros"] as const;
export const BOOKING_TYPES = ["standard", "standard_with_insurance", "monthly"] as const;

export const BOOKING_TYPE_LABELS: Record<(typeof BOOKING_TYPES)[number], string> = {
  standard: "Estándar",
  standard_with_insurance: "Estándar + Seguro Total",
  monthly: "Mensualidad",
};

export const reservationSchema = z.object({
  // Relations
  customer_id: z.string().uuid(),
  rental_company_id: z.string().uuid(),
  referral_id: z.string().uuid().nullable().default(null),
  referral_raw: z.string().nullable().default(null),
  pickup_location_id: z.string().uuid(),
  return_location_id: z.string().uuid(),
  // Identity
  franchise: z.enum(FRANCHISES),
  booking_type: z.enum(BOOKING_TYPES),
  reservation_code: z.string().nullable().default(null),
  reference_token: z.string().nullable().default(null),
  rate_qualifier: z.string().nullable().default(null),
  // Booking
  category_code: z.string().min(1, "Categoría es requerida"),
  pickup_date: z.string().min(1, "Fecha de recogida es requerida"),
  pickup_hour: z.string().min(1, "Hora de recogida es requerida"),
  return_date: z.string().min(1, "Fecha de devolución es requerida"),
  return_hour: z.string().min(1, "Hora de devolución es requerida"),
  selected_days: z.coerce.number().int().min(1),
  // Pricing
  total_price: z.coerce.number().min(0).default(0),
  total_price_to_pay: z.coerce.number().min(0).default(0),
  total_price_localiza: z.coerce.number().min(0).default(0),
  tax_fee: z.coerce.number().min(0).default(0),
  iva_fee: z.coerce.number().min(0).default(0),
  // Coverage
  coverage_days: z.coerce.number().int().min(0).default(0),
  coverage_price: z.coerce.number().min(0).default(0),
  // Extras
  return_fee: z.coerce.number().min(0).default(0),
  extra_hours: z.coerce.number().int().min(0).default(0),
  extra_hours_price: z.coerce.number().min(0).default(0),
  total_insurance: z.coerce.number().min(0).default(0),
  extra_driver: z.boolean().default(false),
  baby_seat: z.boolean().default(false),
  wash: z.boolean().default(false),
  // Flight
  aeroline: z.string().nullable().default(null),
  flight_number: z.string().nullable().default(null),
  // Monthly
  monthly_mileage: z.coerce.number().int().nullable().default(null),
  // Notification
  notification_required: z.boolean().default(false),
  // Status
  status: z.enum(RESERVATION_STATUSES).default("nueva"),
});

export type ReservationFormData = z.infer<typeof reservationSchema>;
