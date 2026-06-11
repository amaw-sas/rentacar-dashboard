import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed projection; the single source of the curated ES names (protected by the
 * no-rename-gamas policy). NOT a parallel PT→ES dictionary — it reads the
 * existing source of truth (`vehicle_categories.name`) keyed by `code`.
 */
export const CATEGORY_NAME_COLUMNS = ["code", "name"] as const;

/** Cache lifetime for the category-name map. The catalog is near-static (~1 row
 * in rental_companies, ~18 in vehicle_categories) and the no-rename-gamas policy
 * means it changes rarely, so a 5-minute staleness window is acceptable (#129). */
export const CATEGORY_NAME_TTL_MS = 5 * 60_000;

let cache: { map: ReadonlyMap<string, string>; expiresAt: number } | null =
  null;
let inflight: Promise<ReadonlyMap<string, string>> | null = null;

/**
 * Map<categoryCode, ES name> for the Localiza company, memoized for
 * CATEGORY_NAME_TTL_MS with single-flight dedup. Includes ALL statuses: this map
 * translates, it does not filter which categories appear (visibility is #111).
 *
 * Caching detail (#129): on a hit within the TTL we return the memoized map; on a
 * miss we share one in-flight promise so concurrent cold-start requests trigger a
 * single fetch, not N. A rejected fetch is NOT cached (`.then` runs only on
 * fulfillment, so `cache` stays null) and `.finally` clears `inflight` on both
 * paths, so the next request retries cleanly.
 *
 * The returned map is SHARED by reference across callers, so the type is
 * `ReadonlyMap` — mutating it would poison the cache for every request within the
 * TTL, and `ReadonlyMap` makes a `set`/`delete` a compile error rather than a
 * silent cross-request bug.
 */
export function getCategoryNameMap(): Promise<ReadonlyMap<string, string>> {
  if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.map);
  if (inflight) return inflight;
  inflight = fetchCategoryNameMap()
    .then((map) => {
      cache = { map, expiresAt: Date.now() + CATEGORY_NAME_TTL_MS };
      return map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Uncached read of the curated ES names. Uses the admin (service-role) client
 * because the calling route is public and has no session, so RLS-via-cookies is
 * unavailable. Same precedent as `lib/api/location-directory.ts`.
 */
async function fetchCategoryNameMap(): Promise<Map<string, string>> {
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
