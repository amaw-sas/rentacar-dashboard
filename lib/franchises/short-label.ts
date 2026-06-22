// Compact franchise tag for dense breakdowns where the full display_name would
// not fit (e.g. the per-period franchise split on the dashboard metric cards).
// Takes the initials of each word / camelCase segment ("AlquilaTuCarro" → "ATC",
// "Alqui Carros" → "AC"); when a single-word name yields fewer than two initials
// it falls back to the first three letters. The full name should still be exposed
// (e.g. via a title tooltip) so the abbreviation never has to be self-explanatory.
export function franchiseShortLabel(displayName: string): string {
  const cleaned = displayName.trim();
  if (!cleaned) return "?";
  // Insert a boundary at lowercase→uppercase transitions so camelCase splits,
  // then split on whitespace and hyphens.
  const segments = cleaned
    .replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .split(/[\s-]+/)
    .filter(Boolean);
  const initials = segments
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 4);
  return cleaned.slice(0, 3).toUpperCase();
}
