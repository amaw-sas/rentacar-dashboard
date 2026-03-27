"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { vehicleCategorySchema } from "@/lib/schemas/vehicle-category";

export async function createVehicleCategory(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = vehicleCategorySchema.safeParse({
    ...raw,
    has_ac: raw.has_ac === "true",
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_categories")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una categoría con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}

export async function updateVehicleCategory(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = vehicleCategorySchema.safeParse({
    ...raw,
    has_ac: raw.has_ac === "true",
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_categories")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una categoría con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/categories");
  return {};
}
