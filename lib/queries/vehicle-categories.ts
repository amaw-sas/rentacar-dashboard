import { createClient } from "@/lib/supabase/server";

export async function getVehicleCategories(rentalCompanyId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("vehicle_categories")
    .select("*, rental_companies(name)")
    .order("name");

  if (rentalCompanyId) {
    query = query.eq("rental_company_id", rentalCompanyId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

export async function getVehicleCategory(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_categories")
    .select("*, rental_companies(name)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
