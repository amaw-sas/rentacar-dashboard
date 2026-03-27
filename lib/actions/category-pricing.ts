"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { categoryPricingSchema } from "@/lib/schemas/category-pricing";

export async function createCategoryPricing(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = categoryPricingSchema.safeParse({
    ...raw,
    valid_until: raw.valid_until || null,
    monthly_1k_price: raw.monthly_1k_price || null,
    monthly_2k_price: raw.monthly_2k_price || null,
    monthly_3k_price: raw.monthly_3k_price || null,
    monthly_insurance_price: raw.monthly_insurance_price || null,
    monthly_one_day_price: raw.monthly_one_day_price || null,
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_pricing")
    .insert(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/categories/${parsed.data.category_id}`);
  return {};
}

export async function updateCategoryPricing(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = categoryPricingSchema.safeParse({
    ...raw,
    valid_until: raw.valid_until || null,
    monthly_1k_price: raw.monthly_1k_price || null,
    monthly_2k_price: raw.monthly_2k_price || null,
    monthly_3k_price: raw.monthly_3k_price || null,
    monthly_insurance_price: raw.monthly_insurance_price || null,
    monthly_one_day_price: raw.monthly_one_day_price || null,
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_pricing")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/categories/${parsed.data.category_id}`);
  return {};
}
