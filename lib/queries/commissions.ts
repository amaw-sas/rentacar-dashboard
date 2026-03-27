import { createClient } from "@/lib/supabase/server";

const COMMISSION_SELECT = `
  *,
  reservations(id, reservation_code, status, total_price, customers(first_name, last_name))
`;

export async function getCommissions(filters?: {
  match_status?: string;
  payment_status?: string;
  import_batch_id?: string;
}) {
  const supabase = await createClient();
  let query = supabase
    .from("commissions")
    .select(COMMISSION_SELECT)
    .order("created_at", { ascending: false });

  if (filters?.match_status) {
    query = query.eq("match_status", filters.match_status);
  }
  if (filters?.payment_status) {
    query = query.eq("payment_status", filters.payment_status);
  }
  if (filters?.import_batch_id) {
    query = query.eq("import_batch_id", filters.import_batch_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCommission(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commissions")
    .select(COMMISSION_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function getCommissionImports() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_imports")
    .select("*, rental_companies(name)")
    .order("imported_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getCommissionImport(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_imports")
    .select("*, rental_companies(name)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function searchReservationsByCode(code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("id, reservation_code, status, total_price, customers(first_name, last_name)")
    .ilike("reservation_code", `%${code}%`)
    .limit(10);

  if (error) throw error;
  return data;
}
