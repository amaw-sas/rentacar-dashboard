import type { CategoryCapacity } from "@/lib/api/category-capacity";

export interface CapacityEnrichableItem {
  categoryCode: string;
  [k: string]: unknown;
}

/**
 * Pure, network-free (testable by injecting the map): merges the capacity/spec
 * fields (passengerCount, luggageCount, transmission, hasAc, picoyplacaExempt)
 * onto each availability item, keyed by `categoryCode`. Runs AFTER the ES-name
 * enrichment (#74) in the availability service.
 *
 * SAFE DEGRADATION, like the name enrichment: an uncurated/new Localiza gama
 * (no capacity row) is passed through UNCHANGED — the item simply omits the
 * capacity fields rather than carrying zeros, so a consumer can tell "unknown"
 * apart from a real 0. Never throws on a miss.
 */
export function enrichCategoryCapacity<T extends CapacityEnrichableItem>(
  items: T[],
  capacityMap: ReadonlyMap<string, CategoryCapacity>,
): (T & Partial<CategoryCapacity>)[] {
  return items.map((item) => {
    const cap = capacityMap.get(item.categoryCode);
    if (cap === undefined) return item;
    return { ...item, ...cap };
  });
}
