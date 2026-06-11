/**
 * Pure aggregation for the Analytics → Origen surface: collapses raw
 * `attribution_channel` rows into one stat per channel that actually appears,
 * ordered by the canonical display order, with "Desconocido" (null) last.
 *
 * No React, no I/O — imported by the client `attribution-charts.tsx` and unit
 * tested in isolation. Labels/colors come from `channel-meta.ts` (single source
 * of truth) so this surface never drifts from the list/detail.
 *
 * Non-enum guard: a non-null string that is not one of the 9 known channels is
 * bucketed under `'other'`. The DB `check` constraint makes this unreachable in
 * practice, but bucketing (rather than dropping) keeps `total` and `pct` honest
 * — every row is counted, so percentages always sum to ~100 and no reservation
 * is silently lost.
 */

import type { AttributionChannel } from "@/lib/attribution/derive-channel";
import {
  ATTRIBUTION_CHANNELS,
  ATTRIBUTION_CHANNEL_SET,
  channelMeta,
} from "@/lib/attribution/channel-meta";

export interface ChannelStat {
  channel: AttributionChannel | null;
  label: string;
  count: number;
  pct: number;
}

/**
 * Aggregate raw rows into per-channel stats.
 *
 * - One entry per channel that actually appears, plus one for `null` rows
 *   ("Desconocido") when any are present.
 * - `total` is the row count over ALL rows (the percentage denominator).
 * - `pct = count / total * 100`, rounded to one decimal.
 * - Ordered by `ATTRIBUTION_CHANNELS` display order, with `null` last.
 * - Unknown non-null channel strings are folded into `'other'` (see module doc).
 */
export function aggregateChannels(
  rows: { attribution_channel: string | null }[],
): { total: number; stats: ChannelStat[] } {
  const total = rows.length;

  // Tally per known channel; `null` rows tracked separately as Desconocido.
  const counts = new Map<AttributionChannel, number>();
  let unknownCount = 0;

  for (const row of rows) {
    const raw = row.attribution_channel;
    if (raw === null) {
      unknownCount++;
      continue;
    }
    // Bucket recognized channels as-is; anything off-enum → 'other'.
    const channel: AttributionChannel = ATTRIBUTION_CHANNEL_SET.has(raw)
      ? (raw as AttributionChannel)
      : "other";
    counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }

  const pct = (count: number): number =>
    total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

  const stats: ChannelStat[] = [];

  // Known channels in canonical display order, only those that appear.
  for (const channel of ATTRIBUTION_CHANNELS) {
    const count = counts.get(channel);
    if (count === undefined || count === 0) continue;
    stats.push({
      channel,
      label: channelMeta(channel).label,
      count,
      pct: pct(count),
    });
  }

  // Desconocido (null) always last, only when present.
  if (unknownCount > 0) {
    stats.push({
      channel: null,
      label: channelMeta(null).label,
      count: unknownCount,
      pct: pct(unknownCount),
    });
  }

  return { total, stats };
}
