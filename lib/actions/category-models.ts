"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { categoryModelSchema } from "@/lib/schemas/category-model";

export async function createCategoryModel(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = categoryModelSchema.safeParse({
    ...raw,
    is_default: raw.is_default === "true",
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_models")
    .insert(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/categories/${parsed.data.category_id}`);
  return {};
}

export async function updateCategoryModel(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = categoryModelSchema.safeParse({
    ...raw,
    is_default: raw.is_default === "true",
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_models")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/categories/${parsed.data.category_id}`);
  return {};
}
