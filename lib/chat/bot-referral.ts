/**
 * The "referido" code the chat bot stamps on a reservation it closes, per brand.
 *
 * The bot is an ADVISOR, not a marketing channel — so its bookings belong in the
 * dashboard's "Referido" column (next to Diana/Daniela), one virtual advisor per
 * brand, NOT in "Origen" (that column keeps the real marketing channel derived
 * from the customer's UTM/click-ids). The code must match a row in `referrals`
 * (lowercase) to render a pretty name; otherwise it falls back to `referral_raw`
 * (the literal code). Injected SERVER-SIDE only — never from the client or the LLM.
 */
const BOT_REFERRAL: Record<string, string> = {
  alquilatucarro: "valeria-bot",
  alquilame: "vanesa-bot",
  alquicarros: "elisa-bot",
};

/** The bot's referido code for a brand, or undefined for an unknown brand (no attribution). */
export function botReferralCode(brand: string): string | undefined {
  return BOT_REFERRAL[brand];
}
