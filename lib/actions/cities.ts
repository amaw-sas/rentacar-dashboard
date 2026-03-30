"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { citySchema } from "@/lib/schemas/city";

export async function createCity(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = citySchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("cities").insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una ciudad con ese slug" };
    }
    return { error: error.message };
  }

  revalidatePath("/cities");
  return {};
}

export async function updateCity(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = citySchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cities")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una ciudad con ese slug" };
    }
    return { error: error.message };
  }

  revalidatePath("/cities");
  return {};
}
