"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { franchiseSchema } from "@/lib/schemas/franchise";

export async function createFranchise(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = franchiseSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("franchises")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una franquicia con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/franchises");
  return {};
}

export async function updateFranchise(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = franchiseSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("franchises")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una franquicia con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/franchises");
  return {};
}
