"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  reservationSchema,
  VALID_TRANSITIONS,
  type ReservationStatus,
} from "@/lib/schemas/reservation";
import {
  sendReservationNotifications,
  sendReservationRequestEmail,
} from "@/lib/email/notifications";
import { sendStatusWhatsApp } from "@/lib/wati/notifications";

function parseBooleanField(value: FormDataEntryValue | null): boolean {
  return value === "true";
}

function buildReservationData(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());

  // Handle boolean fields that come as "true"/"false" strings
  raw.extra_driver = parseBooleanField(formData.get("extra_driver")) as unknown as string;
  raw.baby_seat = parseBooleanField(formData.get("baby_seat")) as unknown as string;
  raw.wash = parseBooleanField(formData.get("wash")) as unknown as string;
  raw.notification_required = parseBooleanField(
    formData.get("notification_required")
  ) as unknown as string;

  // Handle nullable fields — empty strings become null
  if (raw.referral_id === "") raw.referral_id = null as unknown as string;
  if (raw.referral_raw === "") raw.referral_raw = null as unknown as string;
  if (raw.reservation_code === "") raw.reservation_code = null as unknown as string;
  if (raw.reference_token === "") raw.reference_token = null as unknown as string;
  if (raw.rate_qualifier === "") raw.rate_qualifier = null as unknown as string;
  if (raw.aeroline === "") raw.aeroline = null as unknown as string;
  if (raw.flight_number === "") raw.flight_number = null as unknown as string;
  if (raw.monthly_mileage === "") raw.monthly_mileage = null as unknown as string;

  return raw;
}

export async function createReservation(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = buildReservationData(formData);
  const parsed = reservationSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("reservations").insert(parsed.data);

  if (error) {
    return { error: error.message };
  }

  // Fetch inserted reservation ID for email notification
  const { data: inserted } = await supabase
    .from("reservations")
    .select("id")
    .eq("customer_id", parsed.data.customer_id)
    .eq("pickup_date", parsed.data.pickup_date)
    .eq("category_code", parsed.data.category_code)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (inserted) {
    // Non-blocking: log errors but don't fail the action
    sendReservationRequestEmail(inserted.id, parsed.data.franchise).catch(
      (err) => console.error("[email] Reservation request email failed:", err)
    );
  }

  revalidatePath("/reservations");
  return {};
}

export async function updateReservation(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = buildReservationData(formData);
  const parsed = reservationSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/reservations");
  return {};
}

export async function updateReservationStatus(
  id: string,
  newStatus: string
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Fetch current status
  const { data: reservation, error: fetchError } = await supabase
    .from("reservations")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchError) {
    return { error: fetchError.message };
  }

  const currentStatus = reservation.status as ReservationStatus;
  const validTargets = VALID_TRANSITIONS[currentStatus];

  if (!validTargets.includes(newStatus as ReservationStatus)) {
    return {
      error: `Transición no válida: ${currentStatus} → ${newStatus}`,
    };
  }

  // Fetch franchise before update for email notification
  const { data: reservationData } = await supabase
    .from("reservations")
    .select("franchise")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("reservations")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  // Non-blocking: send email + WhatsApp notifications
  if (reservationData?.franchise) {
    sendReservationNotifications(
      id,
      newStatus as ReservationStatus,
      reservationData.franchise
    ).catch((err) =>
      console.error("[email] Status notification failed:", err)
    );

    sendStatusWhatsApp(id, newStatus as ReservationStatus).catch((err) =>
      console.error("[wati] Status notification failed:", err)
    );
  }

  revalidatePath("/reservations");
  return {};
}
