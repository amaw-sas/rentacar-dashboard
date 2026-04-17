export type FranchiseCode = "alquilatucarro" | "alquilame" | "alquicarros";

export const FRANCHISE_BRANDING: Record<
  string,
  { color: string; website: string }
> = {
  alquilatucarro: { color: "#030678", website: "https://alquilatucarro.com" },
  alquilame: { color: "#cc022b", website: "https://alquilame.com" },
  alquicarros: { color: "#ef9600", website: "https://alquicarros.com" },
};

export function getFranchiseBranding(code: string) {
  return FRANCHISE_BRANDING[code] ?? FRANCHISE_BRANDING.alquilame;
}
