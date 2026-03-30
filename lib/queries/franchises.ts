import { createClient } from "@/lib/supabase/server";

export async function getFranchises() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("*")
    .order("display_name");

  if (error) throw error;
  return data;
}

export async function getFranchise(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
