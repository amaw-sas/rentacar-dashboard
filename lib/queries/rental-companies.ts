import { createClient } from "@/lib/supabase/server";

export async function getRentalCompanies() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_companies")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export async function getRentalCompany(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_companies")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
