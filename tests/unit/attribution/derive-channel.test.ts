import { describe, it, expect } from "vitest";
import {
  deriveAttributionChannel,
  OWN_HOSTS,
} from "@/lib/attribution/derive-channel";

describe("deriveAttributionChannel", () => {
  describe("SCEN-001: a Google ad click derives to Google Ads", () => {
    it("gclid present → google_ads", () => {
      expect(deriveAttributionChannel({ gclid: "Cj0KCQ..." })).toBe("google_ads");
    });

    it("gad_source present → google_ads", () => {
      expect(deriveAttributionChannel({ gad_source: "1" })).toBe("google_ads");
    });
  });

  describe("SCEN-002: a Google click tagged display derives to Google Display", () => {
    it("gclid + utm_medium=display → google_display", () => {
      expect(
        deriveAttributionChannel({ gclid: "x", utm_medium: "display" }),
      ).toBe("google_display");
    });
  });

  describe("SCEN-003: platform click-ids derive to their platform", () => {
    it("fbclid → meta_ads", () => {
      expect(deriveAttributionChannel({ fbclid: "x" })).toBe("meta_ads");
    });

    it("msclkid → bing_ads", () => {
      expect(deriveAttributionChannel({ msclkid: "x" })).toBe("bing_ads");
    });

    it("ttclid → tiktok_ads", () => {
      expect(deriveAttributionChannel({ ttclid: "x" })).toBe("tiktok_ads");
    });
  });

  describe("SCEN-004: empty object is Directo, absent is Desconocido", () => {
    it("{} → direct", () => {
      expect(deriveAttributionChannel({})).toBe("direct");
    });

    it("undefined → null", () => {
      expect(deriveAttributionChannel(undefined)).toBeNull();
    });

    it("no-arg call → null", () => {
      expect(deriveAttributionChannel()).toBeNull();
    });
  });

  describe("SCEN-012: the utm fallback ladder (no click-id)", () => {
    it("{utm_source:google, utm_medium:cpc} → google_ads", () => {
      expect(
        deriveAttributionChannel({ utm_source: "google", utm_medium: "cpc" }),
      ).toBe("google_ads");
    });

    it("{utm_medium:organic} → organic", () => {
      expect(deriveAttributionChannel({ utm_medium: "organic" })).toBe("organic");
    });

    it("{utm_source:bing, utm_medium:cpc} → bing_ads", () => {
      expect(
        deriveAttributionChannel({ utm_source: "bing", utm_medium: "cpc" }),
      ).toBe("bing_ads");
    });

    it("{utm_source:google, utm_medium:display} → google_display", () => {
      expect(
        deriveAttributionChannel({ utm_source: "google", utm_medium: "display" }),
      ).toBe("google_display");
    });

    it("{utm_medium:display} (no source) → other", () => {
      expect(deriveAttributionChannel({ utm_medium: "display" })).toBe("other");
    });

    it("{utm_medium:referral} → referral", () => {
      expect(deriveAttributionChannel({ utm_medium: "referral" })).toBe("referral");
    });

    it("{utm_medium:foobar} → other", () => {
      expect(deriveAttributionChannel({ utm_medium: "foobar" })).toBe("other");
    });
  });

  describe("SCEN-013: an external referrer derives to referral", () => {
    it("{referrer:https://www.google.com/} → referral", () => {
      expect(
        deriveAttributionChannel({ referrer: "https://www.google.com/" }),
      ).toBe("referral");
    });
  });

  describe("SCEN-014: an own-domain referrer is internal navigation → Directo", () => {
    it("{referrer:https://www.alquilatucarro.com/gamas} → direct", () => {
      expect(
        deriveAttributionChannel({
          referrer: "https://www.alquilatucarro.com/gamas",
        }),
      ).toBe("direct");
    });

    it("bare own host (no subdomain) → direct", () => {
      expect(
        deriveAttributionChannel({ referrer: "https://alquilame.co/reservar" }),
      ).toBe("direct");
    });
  });

  describe("SCEN-015: derivation is case- and whitespace-insensitive", () => {
    it("{utm_source: '  FACEBOOK  '} → meta_ads", () => {
      expect(deriveAttributionChannel({ utm_source: "  FACEBOOK  " })).toBe(
        "meta_ads",
      );
    });

    it("{gclid: '   '} (whitespace-only) → direct (treated as absent)", () => {
      expect(deriveAttributionChannel({ gclid: "   " })).toBe("direct");
    });
  });

  describe("cross-platform precedence (first-match wins)", () => {
    it("{gclid:x, fbclid:y} → google_ads (rule 2 beats rule 4)", () => {
      expect(deriveAttributionChannel({ gclid: "x", fbclid: "y" })).toBe(
        "google_ads",
      );
    });
  });

  describe("SCEN-016: derivation is total — malformed input never throws", () => {
    it("null input → null (treated as absent), no throw", () => {
      expect(() =>
        deriveAttributionChannel(null as unknown as undefined),
      ).not.toThrow();
      expect(deriveAttributionChannel(null as unknown as undefined)).toBeNull();
    });

    it("non-object input ('foo', 42) → null, no throw", () => {
      expect(deriveAttributionChannel("foo" as unknown as undefined)).toBeNull();
      expect(deriveAttributionChannel(42 as unknown as undefined)).toBeNull();
    });

    it("non-string field values are treated as absent → direct, no throw", () => {
      const malformed = {
        utm_source: 123,
        gclid: 0,
        referrer: 12345,
      } as unknown as Parameters<typeof deriveAttributionChannel>[0];
      expect(() => deriveAttributionChannel(malformed)).not.toThrow();
      expect(deriveAttributionChannel(malformed)).toBe("direct");
    });

    it("a non-string click-id alongside a valid utm still derives from the valid field", () => {
      const mixed = {
        gclid: 999,
        utm_source: "facebook",
      } as unknown as Parameters<typeof deriveAttributionChannel>[0];
      // gclid=999 is non-string → absent; utm_source=facebook → meta_ads.
      expect(deriveAttributionChannel(mixed)).toBe("meta_ads");
    });
  });

  describe("normalization edge cases", () => {
    it("null field values count as absent → direct", () => {
      expect(
        deriveAttributionChannel({ utm_source: null, gclid: null }),
      ).toBe("direct");
    });

    it("unparseable referrer counts as absent → direct", () => {
      expect(deriveAttributionChannel({ referrer: "not a url" })).toBe("direct");
    });

    it("OWN_HOSTS contains the four brand/funnel domains", () => {
      expect(OWN_HOSTS).toEqual(
        expect.arrayContaining([
          "alquilatucarro.com",
          "alquilame.co",
          "alquicarros.com",
          "reservatucarro.com",
        ]),
      );
    });
  });
});
