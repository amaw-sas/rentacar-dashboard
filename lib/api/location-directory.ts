import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Single source of truth for the public location-directory projection.
 * Both the Supabase `.select()` below and the OpenAPI doc-parity test
 * (`LocationDirectoryItem` schema) consume this constant, so the served
 * contract can never drift from what the endpoint actually returns.
 */
export const DIRECTORY_COLUMNS = [
  "slug",
  "code",
  "city",
  "name",
  "status",
  "pickup_address",
  "pickup_map",
  "schedule",
] as const;

export interface LocationDirectoryItem {
  slug: string;
  code: string;
  city: string;
  name: string;
  status: string;
  pickup_address: string;
  pickup_map: string;
  schedule: Record<string, string>;
}

/**
 * Public catalog of active locations: the canonical `slug ↔ code ↔ city`
 * directory an agent reads to translate a human place name into the branch
 * `code` that the availability/reservation endpoints accept.
 *
 * Uses the admin (service-role) client because the calling route is public and
 * has no session, so RLS-via-cookies is unavailable. Read-only, fixed column
 * projection, hard `status = 'active'` filter, no user input.
 */
export async function getLocationDirectory(): Promise<LocationDirectoryItem[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("locations")
    .select(DIRECTORY_COLUMNS.join(", "))
    .eq("status", "active")
    .order("city")
    .order("name");

  if (error) throw error;

  return (data ?? []) as unknown as LocationDirectoryItem[];
}
