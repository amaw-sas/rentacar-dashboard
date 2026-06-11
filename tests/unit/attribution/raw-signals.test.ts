import { describe, it, expect } from "vitest";
import { presentRawSignals } from "@/lib/attribution/raw-signals";

describe("presentRawSignals", () => {
  it("returns exactly the set signals, in display order, with correct labels", () => {
    const row = {
      utm_source: "google",
      utm_medium: null,
      gclid: "Cj0KCQ",
      gad_source: null,
      fbclid: null,
      ttclid: null,
      msclkid: null,
      landing_referrer: null,
    };
    expect(presentRawSignals(row)).toEqual([
      { label: "UTM Source", value: "google" },
      { label: "gclid", value: "Cj0KCQ" },
    ]);
  });

  it("returns [] when every raw column is null", () => {
    const row = {
      utm_source: null,
      utm_medium: null,
      gclid: null,
      gad_source: null,
      fbclid: null,
      ttclid: null,
      msclkid: null,
      landing_referrer: null,
    };
    expect(presentRawSignals(row)).toEqual([]);
  });

  it("surfaces landing_referrer under the 'Referrer' label", () => {
    const row = { landing_referrer: "https://news.example.com/post" };
    expect(presentRawSignals(row)).toEqual([
      { label: "Referrer", value: "https://news.example.com/post" },
    ]);
  });

  it("drops whitespace-only values", () => {
    const row = { utm_source: "   ", utm_medium: "cpc" };
    expect(presentRawSignals(row)).toEqual([
      { label: "UTM Medium", value: "cpc" },
    ]);
  });
});
