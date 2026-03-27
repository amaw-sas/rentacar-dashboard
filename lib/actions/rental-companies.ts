"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rentalCompanySchema } from "@/lib/schemas/rental-company";

export async function createRentalCompany(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = rentalCompanySchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_companies")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una rentadora con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/rental-companies");
  return {};
}

export async function updateRentalCompany(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = rentalCompanySchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_companies")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe una rentadora con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/rental-companies");
  return {};
}
