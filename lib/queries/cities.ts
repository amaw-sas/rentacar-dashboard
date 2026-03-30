import { createClient } from "@/lib/supabase/server";

export async function getCities() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export async function getCity(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cities")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
