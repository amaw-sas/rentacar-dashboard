import { createClient } from "@/lib/supabase/server";

export async function getCategoryVisibility(categoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("category_city_visibility")
    .select("city_id")
    .eq("category_id", categoryId);

  if (error) throw error;
  return data.map((row) => row.city_id);
}

export async function getVisibleCategoriesForCity(cityId: string) {
  const supabase = await createClient();

  // Get categories with visibility_mode = 'all'
  const { data: allCategories, error: allError } = await supabase
    .from("vehicle_categories")
    .select("*, rental_companies(name)")
    .eq("visibility_mode", "all")
    .order("name");

  if (allError) throw allError;

  // Get categories with visibility_mode = 'restricted' that include this city
  const { data: restrictedVisibility, error: visError } = await supabase
    .from("category_city_visibility")
    .select("category_id")
    .eq("city_id", cityId);

  if (visError) throw visError;

  const restrictedCategoryIds = restrictedVisibility.map(
    (row) => row.category_id
  );

  let restrictedCategories: typeof allCategories = [];
  if (restrictedCategoryIds.length > 0) {
    const { data, error } = await supabase
      .from("vehicle_categories")
      .select("*, rental_companies(name)")
      .eq("visibility_mode", "restricted")
      .in("id", restrictedCategoryIds)
      .order("name");

    if (error) throw error;
    restrictedCategories = data;
  }

  return [...allCategories, ...restrictedCategories];
}
