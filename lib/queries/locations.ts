import { createClient } from "@/lib/supabase/server";

export async function getLocations(rentalCompanyId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("locations")
    .select("*, rental_companies(name)")
    .order("name");

  if (rentalCompanyId) {
    query = query.eq("rental_company_id", rentalCompanyId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

export async function getLocation(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
