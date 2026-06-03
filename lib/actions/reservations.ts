"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { snapshotFromCustomer } from "@/lib/queries/customers";
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
import { syncReservationToGhl } from "@/lib/ghl/sync";

function parseBooleanField(value: FormDataEntryValue | null): boolean {
  return value === "true";
}

function buildReservationData(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());

  // Handle boolean fields that come as "true"/"false" strings
  raw.extra_driver = parseBooleanField(formData.get("extra_driver")) as unknown as string;
  raw.baby_seat = parseBooleanField(formData.get("baby_seat")) as unknown as string;
  raw.wash = parseBooleanField(formData.get("wash")) as unknown as string;
  raw.total_insurance = parseBooleanField(
    formData.get("total_insurance")
  ) as unknown as string;
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
  if (raw.nota === "") raw.nota = null as unknown as string;

  return raw;
}

export async function createReservation(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = buildReservationData(formData);
  const parsed = reservationSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    const path = firstError.path.join(".") || "campo";
    return { error: `${path}: ${firstError.message}` };
  }

  const supabase = await createClient();

  // Freeze the booker's identity from the stored customers row (issue #26).
  // Sourced from customer_id, never the form fields, so the snapshot reflects
  // who the FK actually points to. The read throws on a missing row; catch it so
  // a customer_id that no longer resolves returns { error } instead of throwing
  // to the client (action contract, conventions.md). Pre-#26 this surfaced as a
  // graceful FK error — preserve that.
  let snapshot;
  try {
    snapshot = await snapshotFromCustomer(supabase, parsed.data.customer_id);
  } catch {
    return {
      error:
        "No se pudo cargar el cliente de la reserva. Recarga la página e intenta de nuevo.",
    };
  }

  const { error } = await supabase
    .from("reservations")
    .insert({ ...parsed.data, ...snapshot });

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
    syncReservationToGhl(inserted.id).catch((err) =>
      console.error("[ghl] Reservation sync failed:", err)
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

  // Status is owned exclusively by updateReservationStatus (state-machine validation
  // + notifications). Strip it here so a stale form payload cannot revert a status
  // change made via ReservationStatusActions. See issue #10.
  // Referral attribution is fixed at creation (rentacar-web query param or
  // internal new-reservation form). Strip it on update so an operator cannot
  // reassign a referral to themselves and capture commission. See issue #48.
  const {
    status: _ignoredStatus,
    referral_id: _ignoredReferralId,
    referral_raw: _ignoredReferralRaw,
    ...updatePayload
  } = parsed.data;

  const supabase = await createClient();

  // Read the stored owner BEFORE the update to detect a reassignment (issue #26).
  // The update payload never carries snapshot columns, so a plain UPDATE leaves
  // them frozen on the old customer. On reassignment we refresh them via the
  // single-statement RPC (race-free: the guard validates against the same
  // customers row the RPC reads). An unchanged customer_id skips the RPC so a
  // concurrently-mutated customer row cannot re-corrupt the frozen identity
  // (SCEN-005).
  const { data: current, error: fetchError } = await supabase
    .from("reservations")
    .select("customer_id")
    .eq("id", id)
    .single();

  if (fetchError) {
    return {
      error:
        "No se pudo cargar la reserva. Recarga la página e intenta de nuevo.",
    };
  }

  const { error } = await supabase
    .from("reservations")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  if (current.customer_id !== updatePayload.customer_id) {
    const { error: rpcError } = await supabase.rpc("resnapshot_reservation", {
      p_id: id,
    });
    if (rpcError) {
      return { error: rpcError.message };
    }
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

  // Non-blocking: send email + WhatsApp + CRM notifications after the response.
  // WhatsApp sends for `reservado` are spaced (~3s); `after()` keeps the function
  // alive so they aren't truncated, without delaying the dashboard response.
  // Mirrors the dispatch pattern in app/api/reservations/route.ts.
  if (reservationData?.franchise) {
    const franchise = reservationData.franchise;
    after(async () => {
      await Promise.allSettled([
        sendReservationNotifications(
          id,
          newStatus as ReservationStatus,
          franchise
        ).catch((err) =>
          console.error("[email] Status notification failed:", err)
        ),
        sendStatusWhatsApp(id, newStatus as ReservationStatus).catch((err) =>
          console.error("[wati] Status notification failed:", err)
        ),
        syncReservationToGhl(id).catch((err) =>
          console.error("[ghl] Reservation sync failed:", err)
        ),
      ]);
    });
  }

  revalidatePath("/reservations");
  return {};
}
