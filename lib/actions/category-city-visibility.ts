"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateVisibilityMode(
  categoryId: string,
  mode: "all" | "restricted"
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Update the visibility_mode on the category
  const { error: updateError } = await supabase
    .from("vehicle_categories")
    .update({ visibility_mode: mode })
    .eq("id", categoryId);

  if (updateError) {
    return { error: updateError.message };
  }

  // If switching to 'all', remove all pivot rows
  if (mode === "all") {
    const { error: deleteError } = await supabase
      .from("category_city_visibility")
      .delete()
      .eq("category_id", categoryId);

    if (deleteError) {
      return { error: deleteError.message };
    }
  }

  revalidatePath(`/categories/${categoryId}`);
  return {};
}

export async function updateCategoryVisibility(
  categoryId: string,
  cityIds: string[]
): Promise<{ error?: string }> {
  const supabase = await createClient();

  // Delete all existing rows for the category
  const { error: deleteError } = await supabase
    .from("category_city_visibility")
    .delete()
    .eq("category_id", categoryId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  // Insert new rows for each cityId
  if (cityIds.length > 0) {
    const rows = cityIds.map((city_id) => ({
      category_id: categoryId,
      city_id,
    }));

    const { error: insertError } = await supabase
      .from("category_city_visibility")
      .insert(rows);

    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath(`/categories/${categoryId}`);
  return {};
}
