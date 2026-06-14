/**
 * Pure marketing-channel derivation for reservation attribution.
 *
 * Maps an optional `attribution` object (utm params + ad click-ids + referrer)
 * to a single `AttributionChannel`. No I/O. Prioritizes auto-injected click-ids
 * over hand-written utm params (see design §3.3).
 *
 * Load-bearing distinction:
 *   - `undefined` input  → `null`   ("Desconocido" — attribution never captured)
 *   - `{}` empty input   → 'direct' ("Directo" — real direct traffic)
 */

export interface AttributionInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  gclid?: string | null;
  gad_source?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  referrer?: string | null;
}

export type AttributionChannel =
  | "google_ads"
  | "google_display"
  | "meta_ads"
  | "tiktok_ads"
  | "tiktok_organic"
  | "bing_ads"
  | "organic"
  | "referral"
  | "direct"
  | "other";

/**
 * Brand + funnel domains. A referrer whose host is one of these (or a subdomain
 * of one) is internal navigation and carries no attribution → treated as absent.
 */
export const OWN_HOSTS: readonly string[] = [
  "alquilatucarro.com",
  "alquilame.co",
  "alquicarros.com",
  "reservatucarro.com",
];

const DISPLAY_MEDIUMS = new Set(["display", "gdn", "banner", "cpm"]);
const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "paidsearch",
  "paid-search",
  "paid_search",
]);
const ORGANIC_MEDIUMS = new Set(["organic", "social"]);

const GOOGLE_SOURCES = new Set(["google", "googleads", "google-ads", "google_ads"]);
const BING_SOURCES = new Set(["bing", "microsoft", "msn"]);
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);
const TIKTOK_SOURCES = new Set(["tiktok", "tt", "ttads"]);

/**
 * Normalize to lowercase + trim; anything that is not a non-empty string becomes
 * `undefined` (absent). Accepts `unknown` so a non-string field value from an
 * untrusted JSON caller (e.g. `{ utm_source: 123 }`) degrades to absent instead
 * of throwing — the function must stay total (design §5).
 */
function norm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}

/** Parse the referrer host robustly; non-parseable → `undefined` (absent). */
function referrerHost(referrer: string | undefined): string | undefined {
  if (referrer === undefined) return undefined;
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** True when `host` equals an own host or is a subdomain of one. */
function isOwnHost(host: string): boolean {
  return OWN_HOSTS.some((own) => host === own || host.endsWith(`.${own}`));
}

export function deriveAttributionChannel(
  input?: AttributionInput,
): AttributionChannel | null {
  // Rule 1: absent or malformed (null / non-object) input → never captured.
  // `typeof null === "object"`, so null is excluded explicitly. Keeps the
  // function total against untrusted JSON callers (design §5).
  if (input === undefined || input === null || typeof input !== "object") {
    return null;
  }

  const utmSource = norm(input.utm_source);
  const utmMedium = norm(input.utm_medium);
  const gclid = norm(input.gclid);
  const gadSource = norm(input.gad_source);
  const fbclid = norm(input.fbclid);
  const ttclid = norm(input.ttclid);
  const msclkid = norm(input.msclkid);
  const referrer = norm(input.referrer);

  // Rule 2: Google click-id → display vs search.
  if (gclid !== undefined || gadSource !== undefined) {
    if (utmMedium !== undefined && DISPLAY_MEDIUMS.has(utmMedium)) {
      return "google_display";
    }
    return "google_ads";
  }

  // Rule 3: Bing.
  if (msclkid !== undefined || (utmSource !== undefined && BING_SOURCES.has(utmSource))) {
    return "bing_ads";
  }

  // Rule 4: Meta.
  if (fbclid !== undefined || (utmSource !== undefined && META_SOURCES.has(utmSource))) {
    return "meta_ads";
  }

  // Rule 5: TikTok — paid vs organic.
  // `ttclid` is the ad click-id (auto-tagged on PAID clicks only), so it is a
  // reliable paid signal → tiktok_ads. A `tiktok` utm_source without it is an
  // organic bio/profile link → tiktok_organic, unless the medium says paid
  // (cpc/ppc/…), which keeps it in tiktok_ads. (Contrast Meta: `fbclid` is
  // appended to organic clicks too, so Meta cannot be split this way — see #147.)
  if (ttclid !== undefined) {
    return "tiktok_ads";
  }
  if (utmSource !== undefined && TIKTOK_SOURCES.has(utmSource)) {
    if (utmMedium !== undefined && PAID_MEDIUMS.has(utmMedium)) return "tiktok_ads";
    return "tiktok_organic";
  }

  // Rule 6: no click-id, but a utm_medium is present.
  if (utmMedium !== undefined) {
    if (PAID_MEDIUMS.has(utmMedium)) {
      if (utmSource !== undefined && GOOGLE_SOURCES.has(utmSource)) return "google_ads";
      if (utmSource !== undefined && BING_SOURCES.has(utmSource)) return "bing_ads";
      if (utmSource !== undefined && META_SOURCES.has(utmSource)) return "meta_ads";
      if (utmSource !== undefined && TIKTOK_SOURCES.has(utmSource)) return "tiktok_ads";
      return "other";
    }
    if (DISPLAY_MEDIUMS.has(utmMedium)) {
      if (utmSource !== undefined && GOOGLE_SOURCES.has(utmSource)) return "google_display";
      return "other";
    }
    if (ORGANIC_MEDIUMS.has(utmMedium)) return "organic";
    if (utmMedium === "referral") return "referral";
    return "other";
  }

  // Rule 7: no utm, but an external referrer is present → referral.
  // Own-domain referrers are internal navigation → ignored, fall through.
  if (referrer !== undefined) {
    const host = referrerHost(referrer);
    if (host !== undefined && !isOwnHost(host)) return "referral";
  }

  // Rule 8: everything empty (or only an own-domain / unparseable referrer) → direct.
  return "direct";
}
