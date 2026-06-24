import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Category codes (e.g. 'CX') HIDDEN in a city, by city slug — exactly the same
 * rule the website uses (isCategoryVisibleInCity): a category is hidden only when
 * visibility_mode = 'restricted' AND it has a non-empty allowed-cities list AND
 * this city is NOT in it. 'all', and 'restricted' with an EMPTY list, stay visible
 * nationwide (fail open — a half-configured restriction must never delist a sellable
 * gama). Used to filter the chat/MCP quote so it never offers a hidden gama.
 *
 * Admin client: the public chat route has no session. Returns an EMPTY set (hide
 * nothing) when the city slug is unknown. Codes are uppercased.
 */
export async function getHiddenCategoryCodesForCitySlug(
  citySlug: string,
): Promise<Set<string>> {
  const supabase = createAdminClient();
  const hidden = new Set<string>();

  const { data: city, error: cityErr } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", citySlug)
    .maybeSingle();
  if (cityErr) throw cityErr;
  if (!city) return hidden;
  const cityId = city.id as string;

  const { data: restricted, error: rErr } = await supabase
    .from("vehicle_categories")
    .select("id, code")
    .eq("visibility_mode", "restricted");
  if (rErr) throw rErr;
  if (!restricted || restricted.length === 0) return hidden;

  const restrictedIds = (restricted as Array<{ id: string }>).map((c) => c.id);
  const { data: vis, error: vErr } = await supabase
    .from("category_city_visibility")
    .select("category_id, city_id")
    .in("category_id", restrictedIds);
  if (vErr) throw vErr;

  // category_id → set of whitelisted city ids
  const allowed = new Map<string, Set<string>>();
  for (const row of (vis ?? []) as Array<{ category_id: string; city_id: string }>) {
    if (!allowed.has(row.category_id)) allowed.set(row.category_id, new Set());
    allowed.get(row.category_id)!.add(row.city_id);
  }

  for (const c of restricted as Array<{ id: string; code: string | null }>) {
    const cities = allowed.get(c.id);
    if (c.code && cities && cities.size > 0 && !cities.has(cityId)) {
      hidden.add(c.code.toUpperCase());
    }
  }
  return hidden;
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
