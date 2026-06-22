// Single source of truth for per-franchise colors, shared by the dashboard trend
// chart (line stroke) and the metric-card breakdown tags so a franchise reads as
// the same hue everywhere. Assigned by franchise CODE per the brand convention:
// alquilatucarro = blue, alquilame = red, alquicarros = orange-amber. Unknown
// codes fall back to a distinct cycling palette keyed by position, so the chart
// and the tags must pass the SAME index for a fallback color to line up.
export const FRANCHISE_COLORS: Record<string, string> = {
  alquilatucarro: "#2563eb", // azul
  alquilame: "#dc2626", // rojo
  alquicarros: "#d97706", // amarillo-naranja
};

export const FRANCHISE_FALLBACK_COLORS = [
  "#7c3aed",
  "#059669",
  "#0891b2",
  "#db2777",
];

export function franchiseColor(code: string, index: number): string {
  return (
    FRANCHISE_COLORS[code] ??
    FRANCHISE_FALLBACK_COLORS[index % FRANCHISE_FALLBACK_COLORS.length]
  );
}
