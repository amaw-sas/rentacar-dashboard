import { createAdminClient } from "@/lib/supabase/admin";

interface CustomerInput {
  first_name: string;
  last_name: string;
  identification_type: string;
  identification_number: string;
  phone: string;
  email: string;
}

/**
 * Find a location by its branch code (e.g. "AABOT").
 * Returns the location id and rental_company_id, or null if not found.
 */
export async function resolveLocationByCode(
  code: string
): Promise<{ id: string; rental_company_id: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, rental_company_id")
    .eq("code", code)
    .eq("status", "active")
    .limit(1)
    .single();

  if (error || !data) return null;
  return { id: data.id, rental_company_id: data.rental_company_id };
}

/**
 * Find a customer by identification_number (canonical key).
 * If found, refresh contact fields from the reservation input (name, phone, email, identification_type).
 * If not found, create a new customer.
 * Returns the customer id.
 */
export async function findOrCreateCustomer(
  input: CustomerInput
): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("customers")
    .select("id, first_name, last_name, identification_type, phone, email")
    .eq("identification_number", input.identification_number)
    .limit(1)
    .single();

  if (existing) {
    const needsUpdate =
      existing.first_name !== input.first_name ||
      existing.last_name !== input.last_name ||
      existing.identification_type !== input.identification_type ||
      existing.phone !== input.phone ||
      existing.email !== input.email;

    if (needsUpdate) {
      const { error: updateError } = await supabase
        .from("customers")
        .update({
          first_name: input.first_name,
          last_name: input.last_name,
          identification_type: input.identification_type,
          phone: input.phone,
          email: input.email,
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(`Error al actualizar cliente: ${updateError.message}`);
      }
    }

    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      first_name: input.first_name,
      last_name: input.last_name,
      identification_type: input.identification_type,
      identification_number: input.identification_number,
      phone: input.phone,
      email: input.email,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Error al crear cliente: ${error?.message ?? "desconocido"}`);
  }

  return created.id;
}

/**
 * Find a referral by its code.
 * Returns the referral id, or null if not found.
 */
export async function resolveReferral(
  code: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("referrals")
    .select("id")
    .eq("code", code)
    .eq("status", "active")
    .limit(1)
    .single();

  return data?.id ?? null;
}
