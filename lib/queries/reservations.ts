import { createClient } from "@/lib/supabase/server";

const RESERVATION_SELECT = `
  *,
  customers(first_name, last_name, identification_number, phone, email),
  rental_companies(name),
  pickup_location:locations!pickup_location_id(name, city_id, cities(id, name)),
  return_location:locations!return_location_id(name),
  referrals(id, name, code)
`;

const RESERVATION_LIBRO_SELECT = `
  *,
  customers(first_name, last_name, identification_number, phone, email),
  rental_companies(name),
  pickup_location:locations!pickup_location_id(name, pickup_address, return_address, pickup_map, return_map, city),
  return_location:locations!return_location_id(name, pickup_address, return_address, pickup_map, return_map, city),
  referrals(id, name, code)
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

export async function getCustomerReservations(customerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getReferralReservations(referralId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(RESERVATION_SELECT)
    .eq("referral_id", referralId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
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

export async function getReservationForLibro(id: string) {
  const supabase = await createClient();
  const { data: reservation, error } = await supabase
    .from("reservations")
    .select(RESERVATION_LIBRO_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  if (!reservation) return null;

  const { data: category } = await supabase
    .from("vehicle_categories")
    .select("id, name, image_url")
    .eq("code", reservation.category_code)
    .maybeSingle();

  let models: Array<{
    image_url: string | null;
    is_default: boolean;
    status: string;
  }> = [];
  if (category?.id) {
    const { data: modelData } = await supabase
      .from("category_models")
      .select("image_url, is_default, status")
      .eq("category_id", category.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    models = modelData ?? [];
  }

  return { reservation, category, models };
}
