import { createClient } from "@/lib/supabase/server";
import { addDays, subDays, format } from "date-fns";

/** Returns current date in Colombia (UTC-5) */
function todayCOL(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utc - 5 * 60 * 60_000);
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

interface ReservationRecord {
  id: string;
  franchise: string;
  reservation_code: string;
  pickup_date: string;
  pickup_hour: string;
  customers: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
  };
  pickup_location: {
    name: string;
    pickup_address: string;
  };
}

const RESERVATION_REMINDER_SELECT = `
      id,
      franchise,
      reservation_code,
      pickup_date,
      pickup_hour,
      customers (first_name, last_name, phone, email),
      pickup_location:locations!pickup_location_id (name, pickup_address)
    `;

async function queryReservations(
  pickupDate: string,
  hourFrom?: string,
  hourTo?: string
): Promise<ReservationRecord[]> {
  const supabase = await createClient();

  let query = supabase
    .from("reservations")
    .select(RESERVATION_REMINDER_SELECT)
    .eq("status", "reservado")
    .not("reservation_code", "is", null)
    .eq("pickup_date", pickupDate);

  if (hourFrom && hourTo) {
    query = query.gte("pickup_hour", hourFrom).lte("pickup_hour", hourTo);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[reminders] Query error:", error.message);
    return [];
  }

  return (data as unknown as ReservationRecord[]) ?? [];
}

export async function getWeekPickupReservations(): Promise<
  ReservationRecord[]
> {
  const target = addDays(todayCOL(), 7);
  return queryReservations(formatDate(target));
}

export async function getThreeDaysPickupReservations(): Promise<
  ReservationRecord[]
> {
  const target = addDays(todayCOL(), 3);
  return queryReservations(formatDate(target));
}

export async function getSameDayMorningReservations(): Promise<
  ReservationRecord[]
> {
  // Pickup tomorrow between 14:01-23:59 today or 00:00-02:00 tomorrow+1
  // This means: pickup_date = tomorrow, hour between 00:00 and 02:00 OR today with hour 14:01-23:59
  // Re-reading the spec: pickup tomorrow between 14:01-23:59 (of tomorrow)
  // Interpreting: reservations picking up tomorrow with hours 00:00-02:00 or 14:01-23:59
  // Actually the spec says: "pickup tomorrow between 14:01-23:59 today or 00:00-02:00 tomorrow+1"
  // This likely means pickup_date = today with hour 14:01-23:59, OR pickup_date = tomorrow with hour 00:00-02:00
  const today = todayCOL();
  const tomorrow = addDays(today, 1);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
      id,
      franchise,
      reservation_code,
      pickup_date,
      pickup_hour,
      customers (first_name, last_name, phone, email),
      pickup_location:locations!pickup_location_id (name, pickup_address)
    `
    )
    .eq("status", "reservado")
    .not("reservation_code", "is", null)
    .or(
      `and(pickup_date.eq.${formatDate(today)},pickup_hour.gte.14:01,pickup_hour.lte.23:59),and(pickup_date.eq.${formatDate(tomorrow)},pickup_hour.gte.00:00,pickup_hour.lte.02:00)`
    );

  if (error) {
    console.error("[reminders] getSameDayMorningReservations error:", error.message);
    return [];
  }

  return (data as unknown as ReservationRecord[]) ?? [];
}

export async function getSameDayLateReservations(): Promise<
  ReservationRecord[]
> {
  // Pickup tomorrow between 02:01-14:00
  const tomorrow = addDays(todayCOL(), 1);
  return queryReservations(formatDate(tomorrow), "02:01", "14:00");
}

export async function getPostMorningReservations(): Promise<
  ReservationRecord[]
> {
  // Pickup yesterday 17:01 to today 05:00
  const today = todayCOL();
  const yesterday = subDays(today, 1);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
      id,
      franchise,
      reservation_code,
      pickup_date,
      pickup_hour,
      customers (first_name, last_name, phone, email),
      pickup_location:locations!pickup_location_id (name, pickup_address)
    `
    )
    .eq("status", "reservado")
    .not("reservation_code", "is", null)
    .or(
      `and(pickup_date.eq.${formatDate(yesterday)},pickup_hour.gte.17:01,pickup_hour.lte.23:59),and(pickup_date.eq.${formatDate(today)},pickup_hour.gte.00:00,pickup_hour.lte.05:00)`
    );

  if (error) {
    console.error("[reminders] getPostMorningReservations error:", error.message);
    return [];
  }

  return (data as unknown as ReservationRecord[]) ?? [];
}

export async function getPostLateReservations(): Promise<ReservationRecord[]> {
  // Pickup today 05:01-17:00
  const today = todayCOL();
  return queryReservations(formatDate(today), "05:01", "17:00");
}

export async function getReservationForReminder(
  reservationId: string,
): Promise<ReservationRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_REMINDER_SELECT)
    .eq("id", reservationId)
    .single();

  if (error) {
    console.error("[reminders] getReservationForReminder error:", error.message);
    return null;
  }

  return (data as unknown as ReservationRecord) ?? null;
}

export type { ReservationRecord };
