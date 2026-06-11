/**
 * Single source of truth for attribution-channel presentation: ordered channel
 * list, Spanish labels, badge variant, and chart color. Consumed by the
 * reservations list, the reservation detail, and the Analytics → Origen tab.
 *
 * Framework-neutral: pure data + one lookup helper. No React, no I/O — it is
 * imported by both server and client components, so it must NOT be "use client".
 *
 * The `AttributionChannel` type is owned by `derive-channel.ts` (the derivation
 * source of truth) and re-used here — never redefined.
 */

import type { AttributionChannel } from "@/lib/attribution/derive-channel";

/**
 * The 9 channels in deliberate display order: paid platforms first, then
 * organic/referral, then direct/other. This order drives the list filter
 * dropdown, the analytics legend, and any iteration over channels.
 */
export const ATTRIBUTION_CHANNELS: readonly AttributionChannel[] = [
  "google_ads",
  "google_display",
  "meta_ads",
  "tiktok_ads",
  "bing_ads",
  "organic",
  "referral",
  "direct",
  "other",
] as const;

/**
 * O(1) membership set built from `ATTRIBUTION_CHANNELS`, for server-side filter
 * param validation (`parseListParams` rejects any out-of-enum `?origen=` value).
 */
export const ATTRIBUTION_CHANNEL_SET: ReadonlySet<string> = new Set(
  ATTRIBUTION_CHANNELS,
);

/**
 * Reserved list-filter sentinel for "Desconocido" (channel IS NULL). Collision-
 * free by construction: it differs from every channel literal (it is not in
 * `ATTRIBUTION_CHANNEL_SET`) and from the URL-state `ALL` sentinel (`"__all__"`).
 */
export const UNKNOWN_FILTER = "__unknown__";

/** Shadcn badge variants — the established set (see `STATUS_VARIANT`). */
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface ChannelMeta {
  label: string;
  variant: BadgeVariant;
  chartColor: string;
}

/**
 * Chart palette: only 5 CSS vars exist (`--chart-1`..`--chart-5`), and there are
 * 9 channels, so vars are assigned deliberately — each paid platform gets a
 * distinct var (1..5) so the five ad sources are visually separable; the
 * organic/referral/direct/other group reuses vars, which is acceptable because
 * the legend disambiguates and these rarely co-render with their twin in a way
 * that confuses (per Step-3 guidance). Reuse map:
 *   chart-1 google_ads | google_display  (Google family)
 *   chart-2 meta_ads   | organic         (social vs organic, distinct legend rows)
 *   chart-3 tiktok_ads | referral
 *   chart-4 bing_ads   | direct
 *   chart-5 other
 * Desconocido (null) uses --muted-foreground to read as an absence, not a channel.
 */
export const CHANNEL_META: Record<AttributionChannel, ChannelMeta> = {
  google_ads: {
    label: "Google Ads",
    variant: "default",
    chartColor: "hsl(var(--chart-1))",
  },
  google_display: {
    label: "Google Display",
    variant: "secondary",
    chartColor: "hsl(var(--chart-1))",
  },
  meta_ads: {
    label: "Meta Ads",
    variant: "default",
    chartColor: "hsl(var(--chart-2))",
  },
  tiktok_ads: {
    label: "TikTok Ads",
    variant: "default",
    chartColor: "hsl(var(--chart-3))",
  },
  bing_ads: {
    label: "Bing Ads",
    variant: "default",
    chartColor: "hsl(var(--chart-4))",
  },
  organic: {
    label: "Orgánico",
    variant: "secondary",
    chartColor: "hsl(var(--chart-2))",
  },
  referral: {
    label: "Referido web",
    variant: "secondary",
    chartColor: "hsl(var(--chart-3))",
  },
  direct: {
    label: "Directo",
    variant: "outline",
    chartColor: "hsl(var(--chart-4))",
  },
  other: {
    label: "Otro",
    variant: "outline",
    chartColor: "hsl(var(--chart-5))",
  },
};

/**
 * Presentation for the `null` channel: a reservation that never carried
 * attribution ("Desconocido"). Muted variant + muted chart color so it reads as
 * an absence of data, distinct from `direct` (real direct traffic).
 */
export const UNKNOWN_CHANNEL_META: ChannelMeta = {
  label: "Desconocido",
  variant: "outline",
  chartColor: "hsl(var(--muted-foreground))",
};

/**
 * Resolve presentation metadata for a channel. `null` (attribution never
 * captured) returns the "Desconocido" meta. Total over `AttributionChannel | null`,
 * so no badge can ever render unlabeled or uncolored.
 */
export function channelMeta(channel: AttributionChannel | null): ChannelMeta {
  if (channel === null) return UNKNOWN_CHANNEL_META;
  return CHANNEL_META[channel];
}
