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
 * Find a customer by identification_number (canonical key, matches the
 * `customers_identification_number_key` UNIQUE constraint).
 *
 * On match: return the existing id WITHOUT writing. This endpoint is public
 * (rentacar-web → POST /api/reservations) and must never mutate a customer
 * record from booking input — a CC collision (real-on-real typo, or real-on-test)
 * would otherwise silently rewrite the apparent owner of every past reservation
 * tied to that customer, since `reservations` only holds an FK to `customer_id`.
 * See issue #25 (incident 2026-05-12). Historical accuracy of the NEW reservation
 * is handled by the paired snapshot-at-booking fix (#26).
 *
 * On no match: create a new customer.
 *
 * Returns the customer id.
 */
export async function findOrCreateCustomer(
  input: CustomerInput
): Promise<string> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("identification_number", input.identification_number)
    .limit(1)
    .single();

  if (existing) {
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

  if (created) {
    return created.id;
  }

  // Issue #138 — find-after-conflict. The SELECT above and this INSERT are not
  // atomic: two concurrent requests for the SAME new customer (multi-instance
  // Fluid Compute) both pass the empty SELECT, both INSERT, one wins and the
  // other hits the `customers_identification_number_key` unique violation
  // (23505). Recover the winner's id by re-SELECTing — NEVER write (respects
  // #25: a public endpoint must never mutate a customer from booking input).
  // `identification_number` is the only UNIQUE on `customers`, so a 23505 on
  // that constraint is unambiguously this race; any other error still throws.
  if (
    error?.code === "23505" &&
    error.message?.includes("customers_identification_number_key")
  ) {
    const { data: raced } = await supabase
      .from("customers")
      .select("id")
      .eq("identification_number", input.identification_number)
      .limit(1)
      .single();
    if (raced) {
      return raced.id;
    }
  }

  throw new Error(`Error al crear cliente: ${error?.message ?? "desconocido"}`);
}

/**
 * Find a referral by its code.
 * Normalizes input (trim + lowercase) because rentacar-web sends capitalized
 * names like 'Diana' and referrals.code is stored lowercase by convention.
 * Returns the referral id, or null if not found.
 */
export async function resolveReferral(
  code: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const normalized = code.trim().toLowerCase();
  const { data } = await supabase
    .from("referrals")
    .select("id")
    .eq("code", normalized)
    .eq("status", "active")
    .limit(1)
    .single();

  return data?.id ?? null;
}
