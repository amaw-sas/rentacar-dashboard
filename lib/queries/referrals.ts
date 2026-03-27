import { createClient } from "@/lib/supabase/server";

export async function getReferrals(type?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("referrals")
    .select("*")
    .order("name");

  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

export async function getReferral(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("referrals")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
