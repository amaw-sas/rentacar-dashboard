import { createClient } from "@/lib/supabase/server";

export async function getFranchises() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("*")
    .order("display_name");

  if (error) throw error;
  return data;
}

export async function getFranchise(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Logo for the notification preview, looked up by franchise code (the value
// stored on reservations). maybeSingle so an unknown code degrades to null
// instead of throwing — the preview then shows a transparent pixel.
export async function getFranchiseLogoUrl(code: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("franchises")
    .select("logo_url")
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  return data?.logo_url || null;
}
