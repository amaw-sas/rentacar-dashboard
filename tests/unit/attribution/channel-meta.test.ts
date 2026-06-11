import { describe, it, expect } from "vitest";
import type { AttributionChannel } from "@/lib/attribution/derive-channel";
import {
  ATTRIBUTION_CHANNELS,
  ATTRIBUTION_CHANNEL_SET,
  CHANNEL_META,
  UNKNOWN_FILTER,
  channelMeta,
} from "@/lib/attribution/channel-meta";

const ALLOWED_VARIANTS = ["default", "secondary", "destructive", "outline"];

// Authoritative label map — design §4.
const EXPECTED_LABELS: Record<AttributionChannel | "null", string> = {
  google_ads: "Google Ads",
  google_display: "Google Display",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  bing_ads: "Bing Ads",
  organic: "Orgánico",
  referral: "Referido web",
  direct: "Directo",
  other: "Otro",
  null: "Desconocido",
};

describe("channel-meta — SCEN-017: every channel has a complete presentation", () => {
  describe("each channel (and null) resolves to non-empty label + valid variant + non-empty color", () => {
    for (const channel of ATTRIBUTION_CHANNELS) {
      it(`${channel} → complete meta`, () => {
        const meta = channelMeta(channel);
        expect(meta.label.length).toBeGreaterThan(0);
        expect(ALLOWED_VARIANTS).toContain(meta.variant);
        expect(meta.chartColor.length).toBeGreaterThan(0);
      });
    }

    it("null (Desconocido) → complete meta", () => {
      const meta = channelMeta(null);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(ALLOWED_VARIANTS).toContain(meta.variant);
      expect(meta.chartColor.length).toBeGreaterThan(0);
    });
  });

  describe("exact label map (design §4), all 10 entries including Desconocido", () => {
    for (const channel of ATTRIBUTION_CHANNELS) {
      it(`${channel} → "${EXPECTED_LABELS[channel]}"`, () => {
        expect(channelMeta(channel).label).toBe(EXPECTED_LABELS[channel]);
      });
    }

    it('null → "Desconocido"', () => {
      expect(channelMeta(null).label).toBe(EXPECTED_LABELS.null);
    });
  });

  describe("CHANNEL_META covers exactly the 9 channels", () => {
    it("CHANNEL_META keys equal ATTRIBUTION_CHANNELS", () => {
      expect(Object.keys(CHANNEL_META).sort()).toEqual(
        [...ATTRIBUTION_CHANNELS].sort(),
      );
    });
  });

  describe("ATTRIBUTION_CHANNEL_SET — server-side filter validation", () => {
    it("has exactly the 9 channel literals", () => {
      expect(ATTRIBUTION_CHANNEL_SET.size).toBe(9);
    });

    it("contains each channel literal", () => {
      for (const channel of ATTRIBUTION_CHANNELS) {
        expect(ATTRIBUTION_CHANNEL_SET.has(channel)).toBe(true);
      }
    });
  });

  describe("UNKNOWN_FILTER sentinel is collision-free", () => {
    it('equals "__unknown__"', () => {
      expect(UNKNOWN_FILTER).toBe("__unknown__");
    });

    it("is NOT a member of ATTRIBUTION_CHANNEL_SET", () => {
      expect(ATTRIBUTION_CHANNEL_SET.has(UNKNOWN_FILTER)).toBe(false);
    });

    it('differs from the list ALL sentinel ("__all__")', () => {
      expect(UNKNOWN_FILTER).not.toBe("__all__");
    });
  });

  describe("ATTRIBUTION_CHANNELS shape", () => {
    it("has length 9", () => {
      expect(ATTRIBUTION_CHANNELS).toHaveLength(9);
    });

    it("has no duplicates", () => {
      expect(new Set(ATTRIBUTION_CHANNELS).size).toBe(ATTRIBUTION_CHANNELS.length);
    });
  });
});
