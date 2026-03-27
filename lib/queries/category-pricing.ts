import { createClient } from "@/lib/supabase/server";

export async function getCategoryPricing(categoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_pricing")
    .select("*")
    .eq("category_id", categoryId)
    .order("valid_from", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getCategoryPricingById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_pricing")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
