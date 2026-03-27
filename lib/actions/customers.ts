"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { customerSchema } from "@/lib/schemas/customer";

export async function createCustomer(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      if (error.message.includes("identification_number")) {
        return { error: "Ya existe un cliente con ese número de identificación" };
      }
      if (error.message.includes("email")) {
        return { error: "Ya existe un cliente con ese email" };
      }
      return { error: "Ya existe un cliente con esos datos" };
    }
    return { error: error.message };
  }

  revalidatePath("/customers");
  return {};
}

export async function updateCustomer(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      if (error.message.includes("identification_number")) {
        return { error: "Ya existe un cliente con ese número de identificación" };
      }
      if (error.message.includes("email")) {
        return { error: "Ya existe un cliente con ese email" };
      }
      return { error: "Ya existe un cliente con esos datos" };
    }
    return { error: error.message };
  }

  revalidatePath("/customers");
  return {};
}
