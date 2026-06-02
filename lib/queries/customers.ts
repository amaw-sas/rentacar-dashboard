import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Denormalized snapshot of the booker's identity, frozen onto a reservation at
 * INSERT time (issue #26). Reservations hold only a `customer_id` FK; a later
 * edit to the customers row (or a #25 lenient CC-collision) would otherwise
 * rewrite the apparent owner of every past reservation. These columns preserve
 * who booked, as stored, when the reservation was created.
 */
export type CustomerSnapshot = {
  customer_name_at_booking: string;
  customer_email_at_booking: string;
  customer_phone_at_booking: string;
  customer_identification_type_at_booking: string;
  customer_identification_number_at_booking: string;
};

/**
 * Build a {@link CustomerSnapshot} by reading the customers row the reservation
 * will point to. The snapshot is sourced from the STORED row (not raw request
 * input) so a CC-collision that resolves to an existing customer freezes that
 * customer's data — faithful to where the FK actually lands.
 *
 * Takes the Supabase client as a param so callers supply the right scope
 * (admin client for the public API, RLS client for the dashboard action). The
 * clients are untyped, hence the `SupabaseClient` annotation.
 */
export async function snapshotFromCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerSnapshot> {
  const { data, error } = await supabase
    .from("customers")
    .select(
      "first_name,last_name,email,phone,identification_type,identification_number",
    )
    .eq("id", customerId)
    .single();

  if (error || !data) {
    throw new Error(
      `No se pudo leer el cliente ${customerId} para el snapshot: ${error?.message ?? "no encontrado"}`,
    );
  }

  return {
    customer_name_at_booking: `${data.first_name} ${data.last_name}`,
    customer_email_at_booking: data.email,
    customer_phone_at_booking: data.phone,
    customer_identification_type_at_booking: data.identification_type,
    customer_identification_number_at_booking: data.identification_number,
  };
}

export async function getCustomers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("last_name");

  if (error) throw error;
  return data;
}

export async function getCustomer(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
