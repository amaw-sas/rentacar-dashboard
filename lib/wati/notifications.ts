import { createAdminClient } from "@/lib/supabase/admin";
import { addContact, sendTemplateMessage } from "./client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { ReservationStatus } from "@/lib/schemas/reservation";
import { logNotification } from "@/lib/actions/notification-logs";

const WATI_TYPE_MAP: Partial<Record<ReservationStatus, string>> = {
  reservado: "whatsapp_reservado",
  pendiente: "whatsapp_pendiente",
  sin_disponibilidad: "whatsapp_sin_disponibilidad",
  mensualidad: "whatsapp_mensualidad",
};

const STATUS_TEMPLATES: Partial<
  Record<ReservationStatus, string>
> = {
  reservado: "nueva_reserva_5",
  pendiente: "reserva_pendiente",
  sin_disponibilidad: "reserva_sin_disponibilidad",
  mensualidad: "reserva_mensual",
};

const ADDITIONAL_TEMPLATES: Record<string, string[]> = {
  reservado: [
    "nueva_reserva_instrucciones_2",
    "nueva_reserva_instrucciones_adicionales",
  ],
};

function formatDate(dateStr: string): string {
  return format(new Date(dateStr + "T12:00:00"), "d 'de' MMMM 'de' yyyy", {
    locale: es,
  });
}

function formatHour(hourStr: string): string {
  const [h, m] = hourStr.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

export async function sendStatusWhatsApp(
  reservationId: string,
  status: ReservationStatus,
): Promise<void> {
  const templateName = STATUS_TEMPLATES[status];
  if (!templateName) return;

  try {
    const supabase = createAdminClient();
    const { data: reservation, error } = await supabase
      .from("reservations")
      .select(
        `*, customers(first_name, last_name, phone),
        pickup_location:locations!pickup_location_id(name, pickup_address, return_address, pickup_map, return_map),
        return_location:locations!return_location_id(name, pickup_address, return_address, pickup_map, return_map),
        franchises:franchise`
      )
      .eq("id", reservationId)
      .single();

    if (error || !reservation) {
      console.error(`[wati] Failed to fetch reservation ${reservationId}:`, error?.message);
      return;
    }

    const customer = reservation.customers as {
      first_name: string;
      last_name: string;
      phone: string;
    };
    const phone = customer.phone;
    if (!phone) return;

    const fullname = `${customer.first_name} ${customer.last_name}`;
    type LocationRow = {
      name: string;
      pickup_address: string;
      return_address: string | null;
      pickup_map: string;
      return_map: string | null;
    };
    const pickupLoc = reservation.pickup_location as LocationRow | null;
    const returnLoc = reservation.return_location as LocationRow | null;

    const pickupAddress = pickupLoc?.pickup_address ?? "";
    const pickupMap = pickupLoc?.pickup_map ?? "";
    // For the return side, prefer the return_* fields; fallback to pickup_* (same physical spot).
    const returnAddress = returnLoc?.return_address ?? returnLoc?.pickup_address ?? "";
    const returnMap = returnLoc?.return_map ?? returnLoc?.pickup_map ?? "";

    // Fetch franchise data
    const { data: franchise } = await supabase
      .from("franchises")
      .select("display_name, website")
      .eq("code", reservation.franchise)
      .single();

    const franchiseName = franchise?.display_name ?? reservation.franchise;
    const franchiseWebsite = franchise?.website ?? "";

    // Register contact
    await addContact(phone, fullname);

    // Build params based on status
    let params: { name: string; value: string }[] = [];
    const today = format(new Date(), "yyyy-MM-dd");
    const broadcastName = `Status ${status} ${today}`;

    if (status === "reservado") {
      params = [
        { name: "fullname", value: fullname },
        { name: "reservation_code", value: reservation.reservation_code ?? "" },
        { name: "pickup_date", value: formatDate(reservation.pickup_date) },
        { name: "pickup_hour", value: formatHour(reservation.pickup_hour) },
        { name: "pickup_location", value: pickupLoc?.name ?? "" },
        { name: "pickup_location_address", value: pickupAddress },
        { name: "pickup_location_map", value: pickupMap },
        { name: "return_date", value: formatDate(reservation.return_date) },
        { name: "return_hour", value: formatHour(reservation.return_hour) },
        { name: "return_location", value: returnLoc?.name ?? "" },
        { name: "return_location_address", value: returnAddress },
        { name: "return_location_map", value: returnMap },
        { name: "franchise_name", value: franchiseName },
      ];
    } else if (status === "pendiente" || status === "mensualidad") {
      params = [
        { name: "fullname", value: fullname },
        { name: "franchise_name", value: franchiseName },
      ];
    } else if (status === "sin_disponibilidad") {
      params = [
        { name: "fullname", value: fullname },
        { name: "franchise_reservation_website", value: franchiseWebsite },
      ];
    }

    await sendTemplateMessage(phone, templateName, broadcastName, params);

    // Send additional templates (instructions for reserved)
    const extras = ADDITIONAL_TEMPLATES[status];
    if (extras) {
      for (const extra of extras) {
        await sendTemplateMessage(phone, extra, `${extra} ${today}`, params);
      }
    }

    console.log(`[wati] Status ${status} WhatsApp sent to ${phone} for reservation ${reservationId}`);

    const watiType = WATI_TYPE_MAP[status];
    if (watiType) {
      logNotification({
        reservation_id: reservationId,
        channel: "whatsapp",
        notification_type: watiType,
        recipient: phone,
        status: "sent",
      }).catch((err) => console.error("[notification-log] Log failed:", err));
    }
  } catch (error) {
    console.error(`[wati] Failed to send status WhatsApp for ${reservationId}:`, error);

    const watiType = WATI_TYPE_MAP[status];
    if (watiType) {
      logNotification({
        reservation_id: reservationId,
        channel: "whatsapp",
        notification_type: watiType,
        recipient: "unknown",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
      }).catch((err) => console.error("[notification-log] Log failed:", err));
    }
  }
}
