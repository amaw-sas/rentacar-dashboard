"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { referralSchema } from "@/lib/schemas/referral";

export async function createReferral(
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = referralSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("referrals")
    .insert(parsed.data);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un referido con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/referrals");
  return {};
}

export async function updateReferral(
  id: string,
  formData: FormData
): Promise<{ error?: string }> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = referralSchema.safeParse(raw);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("referrals")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Ya existe un referido con ese código" };
    }
    return { error: error.message };
  }

  revalidatePath("/referrals");
  return {};
}
