"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { locationSchema } from "@/lib/schemas/location";

export async function createLocation(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = locationSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una sucursal con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/locations");
  return {};
}

export async function updateLocation(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = locationSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una sucursal con ese código para esta rentadora" };
    }
    return { error: error.message };
  }

  revalidatePath("/locations");
  return {};
}
