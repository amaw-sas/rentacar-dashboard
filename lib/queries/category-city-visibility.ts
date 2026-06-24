import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Category codes (e.g. 'C', 'CX') that are VISIBLE in a city, by city slug.
 * A category shows in a city when visibility_mode = 'all', or 'restricted' and
 * the city is in its category_city_visibility list. Used to filter the chat/MCP
 * availability so it never offers a gama the dashboard hid for that city.
 *
 * Admin client: the public chat route has no session. Returns null when the city
 * slug is unknown (caller then doesn't filter — fail open). Codes are uppercased.
 */
export async function getVisibleCategoryCodesForCitySlug(
  citySlug: string,
): Promise<Set<string> | null> {
  const supabase = createAdminClient();

  const { data: city, error: cityErr } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", citySlug)
    .maybeSingle();
  if (cityErr) throw cityErr;
  if (!city) return null;

  const { data: allCats, error: allErr } = await supabase
    .from("vehicle_categories")
    .select("code")
    .eq("visibility_mode", "all");
  if (allErr) throw allErr;

  const { data: vis, error: visErr } = await supabase
    .from("category_city_visibility")
    .select("category_id")
    .eq("city_id", city.id as string);
  if (visErr) throw visErr;

  const restrictedIds = (vis ?? []).map((r) => r.category_id as string);
  let restricted: Array<{ code: string | null }> = [];
  if (restrictedIds.length > 0) {
    const { data, error } = await supabase
      .from("vehicle_categories")
      .select("code")
      .eq("visibility_mode", "restricted")
      .in("id", restrictedIds);
    if (error) throw error;
    restricted = (data ?? []) as Array<{ code: string | null }>;
  }

  const codes = new Set<string>();
  for (const c of (allCats ?? []) as Array<{ code: string | null }>) {
    if (c.code) codes.add(c.code.toUpperCase());
  }
  for (const c of restricted) {
    if (c.code) codes.add(c.code.toUpperCase());
  }
  return codes;
}

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
