import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed projection; the single source of the curated ES names (protected by the
 * no-rename-gamas policy). NOT a parallel PT→ES dictionary — it reads the
 * existing source of truth (`vehicle_categories.name`) keyed by `code`.
 */
export const CATEGORY_NAME_COLUMNS = ["code", "name"] as const;

/**
 * Map<categoryCode, ES name> for the Localiza company. Includes ALL statuses:
 * this map translates, it does not filter which categories appear (visibility
 * is #111, out of scope).
 *
 * Uses the admin (service-role) client because the calling route is public and
 * has no session, so RLS-via-cookies is unavailable. Same precedent as
 * `lib/api/location-directory.ts`.
 */
export async function getCategoryNameMap(): Promise<Map<string, string>> {
  const supabase = createAdminClient();

  // Resolve the Localiza company by its unique code. No reusable helper exists
  // (lib/queries/rental-companies.ts uses the RLS client); this public route
  // needs admin. `rental_companies.code` is NOT NULL UNIQUE → `.single()` is
  // deterministic. Filtering categories by this id (not a global `code`)
  // prevents a shared code across companies from collapsing names.
  const { data: company, error: companyError } = await supabase
    .from("rental_companies")
    .select("id")
    .eq("code", "localiza")
    .single();
  if (companyError) throw companyError;
  const localizaId = (company as unknown as { id: string }).id;

  const { data, error } = await supabase
    .from("vehicle_categories")
    .select(CATEGORY_NAME_COLUMNS.join(", "))
    .eq("rental_company_id", localizaId);
  if (error) throw error;

  // The string-form `.select(...join(", "))` erases the row type (a dynamic
  // select returns a loosely-typed result that won't narrow), so the cast is
  // unavoidable — do NOT "fix" it into a typed select, that would break the
  // single-source CATEGORY_NAME_COLUMNS pattern. Same precedent as
  // lib/api/location-directory.ts.
  const rows = (data ?? []) as unknown as { code: string; name: string }[];
  return new Map(rows.map((r) => [r.code, r.name]));
}
