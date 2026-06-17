import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Capacity/spec metadata per Localiza gama, keyed by `code`. Sibling of
 * `category-names.ts` (#74) and intentionally separate: the name map predates
 * this and has its own tightly-tested cache, so capacity is layered additively
 * (#72 AI-first quoting) rather than threaded through that map. Both read the
 * tiny `vehicle_categories` table (~18 rows) under a 5-minute TTL, so the second
 * cached read is negligible and keeps each concern independently testable.
 *
 * Surfaced so an AI agent quoting via the public availability endpoint can answer
 * "qué carro para 5 personas con 4 maletas", "automático", "sin pico y placa".
 */
export const CATEGORY_CAPACITY_COLUMNS = [
  "code",
  "passenger_count",
  "luggage_count",
  "transmission",
  "has_ac",
  "picoyplaca_exempt",
] as const;

/** Mirrors CATEGORY_NAME_TTL_MS: the catalog is near-static under the
 * no-rename-gamas policy, so a 5-minute staleness window is acceptable. */
export const CATEGORY_CAPACITY_TTL_MS = 5 * 60_000;

export interface CategoryCapacity {
  passengerCount: number;
  luggageCount: number;
  transmission: "automatic" | "manual";
  hasAc: boolean;
  picoyplacaExempt: boolean;
}

let cache: {
  map: ReadonlyMap<string, CategoryCapacity>;
  expiresAt: number;
} | null = null;
let inflight: Promise<ReadonlyMap<string, CategoryCapacity>> | null = null;

/**
 * Map<categoryCode, CategoryCapacity> for the Localiza company, memoized for
 * CATEGORY_CAPACITY_TTL_MS with single-flight dedup. Same caching contract as
 * getCategoryNameMap (#129): a rejected fetch is NOT cached and `inflight` is
 * cleared on both paths, so the next request retries cleanly. The returned map
 * is SHARED by reference, hence `ReadonlyMap` to make mutation a compile error.
 */
export function getCategoryCapacityMap(): Promise<
  ReadonlyMap<string, CategoryCapacity>
> {
  if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.map);
  if (inflight) return inflight;
  inflight = fetchCategoryCapacityMap()
    .then((map) => {
      cache = { map, expiresAt: Date.now() + CATEGORY_CAPACITY_TTL_MS };
      return map;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Uncached read. Uses the admin (service-role) client because the calling route
 * is public and has no session, so RLS-via-cookies is unavailable — same
 * precedent as `category-names.ts` and `location-directory.ts`. Filters
 * categories by the resolved Localiza company id (not a global `code`) so a
 * shared code across companies cannot collapse rows.
 */
async function fetchCategoryCapacityMap(): Promise<
  Map<string, CategoryCapacity>
> {
  const supabase = createAdminClient();

  const { data: company, error: companyError } = await supabase
    .from("rental_companies")
    .select("id")
    .eq("code", "localiza")
    .single();
  if (companyError) throw companyError;
  const localizaId = (company as unknown as { id: string }).id;

  const { data, error } = await supabase
    .from("vehicle_categories")
    .select(CATEGORY_CAPACITY_COLUMNS.join(", "))
    .eq("rental_company_id", localizaId);
  if (error) throw error;

  // The string-form `.select(...join(", "))` erases the row type, so the cast is
  // unavoidable — do NOT "fix" it into a typed select, that would break the
  // single-source CATEGORY_CAPACITY_COLUMNS pattern (same precedent as
  // category-names.ts / location-directory.ts).
  const rows = (data ?? []) as unknown as {
    code: string;
    passenger_count: number;
    luggage_count: number;
    transmission: "automatic" | "manual";
    has_ac: boolean;
    picoyplaca_exempt: boolean;
  }[];

  return new Map(
    rows.map((r) => [
      r.code,
      {
        passengerCount: r.passenger_count,
        luggageCount: r.luggage_count,
        transmission: r.transmission,
        hasAc: r.has_ac,
        picoyplacaExempt: r.picoyplaca_exempt,
      },
    ]),
  );
}
