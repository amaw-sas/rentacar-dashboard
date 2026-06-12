export interface AvailabilityItem {
  categoryCode: string;
  categoryDescription: string;
  [k: string]: unknown; // price, token, IVA, … — passed through untouched
}

/**
 * Pure, network-free: testable by injecting the map. Replaces categoryDescription
 * with the curated Spanish name when the code is mapped; on a miss it keeps the
 * raw value and logs — never blanks the field, so availability stays readable even
 * for a Localiza gama not yet curated in vehicle_categories.
 */
export function enrichCategoryDescriptions(
  items: AvailabilityItem[],
  nameMap: ReadonlyMap<string, string>,
): AvailabilityItem[] {
  return items.map((item) => {
    const es = nameMap.get(item.categoryCode);
    if (es !== undefined) return { ...item, categoryDescription: es };
    // New/uncurated Localiza gama: keep raw (never blank) and surface it for triage.
    logUnmappedCategory(item.categoryCode);
    return item;
  });
}

/**
 * One structured JSON line per unmapped code so uncurated gamas are discoverable
 * in logs. Mirrors the proxy's localiza_warning_unmapped pattern
 * (proxy/src/localiza/warnings.ts), but resident in the dashboard.
 */
function logUnmappedCategory(categoryCode: string): void {
  console.warn(
    JSON.stringify({
      level: "WARN",
      event: "localiza_category_unmapped",
      categoryCode,
      timestamp: new Date().toISOString(),
    }),
  );
}
