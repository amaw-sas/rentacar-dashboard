import { createClient } from "@/lib/supabase/server";

const RESERVATION_SELECT = `
  *,
  customers(first_name, last_name),
  rental_companies(name),
  pickup_location:locations!pickup_location_id(name),
  return_location:locations!return_location_id(name),
  referrals(name, code)
`;

export async function getReservations() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getReservation(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
