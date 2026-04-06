import { createClient } from "@/lib/supabase/server";
import { sendReservationNotifications } from "@/lib/email/notifications";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";
import type { ReservationStatus } from "@/lib/schemas/reservation";

const LOCALIZA_STATUS_MAP: Record<string, ReservationStatus> = {
  Confirmed: "reservado",
  Reserved: "reservado",
  Failed: "sin_disponibilidad",
  Cancelled: "indeterminado",
  Waitlist: "indeterminado",
  "On Request": "indeterminado",
  Pending: "pendiente", // no change
};

export async function checkPendingReservationStatuses(): Promise<{
  checked: number;
  updated: number;
  errors: number;
}> {
  const proxyUrl = process.env.LOCALIZA_PROXY_URL;
  const proxyApiKey = process.env.PROXY_API_KEY;

  if (!proxyUrl || !proxyApiKey) {
    console.error("[check-pending] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
    return { checked: 0, updated: 0, errors: 0 };
  }

  const supabase = await createClient();

  const { data: pendingReservations, error } = await supabase
    .from("reservations")
    .select("id, reservation_code, franchise")
    .eq("status", "pendiente")
    .not("reservation_code", "is", null);

  if (error || !pendingReservations) {
    console.error("[check-pending] Failed to fetch pending reservations:", error?.message);
    return { checked: 0, updated: 0, errors: 0 };
  }

  let updated = 0;
  let errors = 0;

  for (const reservation of pendingReservations) {
    try {
      const response = await fetch(`${proxyUrl}/api/localiza/check-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": proxyApiKey,
        },
        body: JSON.stringify({
          reservationCode: reservation.reservation_code,
        }),
      });

      if (!response.ok) {
        console.error(
          `[check-pending] Proxy error for ${reservation.reservation_code}: ${response.status}`
        );
        errors++;
        continue;
      }

      const result = await response.json() as {
        reservationStatus: string;
        reserveCode: string;
      };

      const newStatus = LOCALIZA_STATUS_MAP[result.reservationStatus];
      if (!newStatus || newStatus === "pendiente") continue;

      // Update status in DB
      const { error: updateError } = await supabase
        .from("reservations")
        .update({ status: newStatus })
        .eq("id", reservation.id);

      if (updateError) {
        console.error(
          `[check-pending] Failed to update ${reservation.reservation_code}:`,
          updateError.message
        );
        errors++;
        continue;
      }

      updated++;
      console.log(
        `[check-pending] ${reservation.reservation_code}: pendiente → ${newStatus}`
      );

      // Send notifications for the new status
      if (reservation.franchise) {
        sendReservationNotifications(
          reservation.id,
          newStatus,
          reservation.franchise
        ).catch((err) =>
          console.error("[check-pending] Email notification failed:", err)
        );

        sendStatusWhatsApp(reservation.id, newStatus).catch((err) =>
          console.error("[check-pending] WhatsApp notification failed:", err)
        );
      }
    } catch (err) {
      console.error(
        `[check-pending] Error checking ${reservation.reservation_code}:`,
        err
      );
      errors++;
    }
  }

  console.log(
    `[check-pending] Done: checked=${pendingReservations.length}, updated=${updated}, errors=${errors}`
  );

  return { checked: pendingReservations.length, updated, errors };
}
