"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { customerSchema, customerContactSchema } from "@/lib/schemas/customer";

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
    if (error.code === "23505" && error.message.includes("identification_number")) {
      return { error: "Ya existe un cliente con ese número de identificación" };
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
    if (error.code === "23505" && error.message.includes("identification_number")) {
      return { error: "Ya existe un cliente con ese número de identificación" };
    }
    return { error: error.message };
  }

  revalidatePath("/customers");
  return {};
}

// Partial contact update invoked from the reservation edit form (#36).
// Only the 6 contact columns are written — notes/status stay untouched.
export async function updateCustomerContact(
  id: string,
  formData: FormData,
  reservationId?: string
): Promise<{ error?: string }> {
  if (!id) {
    return { error: "Cliente no seleccionado" };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = customerContactSchema.safeParse(raw);

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
    if (error.code === "23505" && error.message.includes("identification_number")) {
      return { error: "Ya existe un cliente con ese número de identificación" };
    }
    return { error: error.message };
  }

  // Inline contact edit from a reservation form re-snapshots ONLY that
  // reservation (issue #26, SCEN-009): the explicit correction is reflected on
  // R while the customer's other reservations stay frozen. The RPC reads the
  // just-updated customers row, so the match-guard trigger accepts the write.
  // Without a reservationId (edit from the customers page) nothing re-snapshots.
  if (reservationId) {
    const { error: rpcError } = await supabase.rpc("resnapshot_reservation", {
      p_id: reservationId,
    });
    if (rpcError) {
      return { error: rpcError.message };
    }
  }

  revalidatePath("/customers");
  revalidatePath("/reservations");
  return {};
}
