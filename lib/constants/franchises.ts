export type FranchiseCode = "alquilatucarro" | "alquilame" | "alquicarros";

// `whatsapp` = the brand's advisor number (digits only, incl. country code),
// mirroring each site's contact WhatsApp. Used by the chat fallback link when a
// booking can't be created so the lead can finish with a human.
export const FRANCHISE_BRANDING: Record<
  string,
  { color: string; website: string; whatsapp: string }
> = {
  alquilatucarro: {
    color: "#030678",
    website: "https://alquilatucarro.com",
    whatsapp: "573016729250",
  },
  alquilame: {
    color: "#cc022b",
    website: "https://alquilame.co",
    whatsapp: "573146826821",
  },
  alquicarros: {
    color: "#ef9600",
    website: "https://alquicarros.com",
    whatsapp: "573146826821",
  },
};

export function getFranchiseBranding(code: string) {
  return FRANCHISE_BRANDING[code] ?? FRANCHISE_BRANDING.alquilame;
}
