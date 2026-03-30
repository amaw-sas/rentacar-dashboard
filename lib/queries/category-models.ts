import { createClient } from "@/lib/supabase/server";

export async function getCategoryModels(categoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_models")
    .select("*")
    .eq("category_id", categoryId)
    .order("name");

  if (error) throw error;
  return data;
}

export async function getCategoryModel(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_models")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
