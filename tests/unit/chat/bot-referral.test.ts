import { describe, it, expect } from "vitest";
import { botReferralCode } from "@/lib/chat/bot-referral";

describe("botReferralCode — the bot's per-brand referido", () => {
  it("maps each brand to its lowercase bot code (matches the referrals seed)", () => {
    expect(botReferralCode("alquilatucarro")).toBe("valeria-bot");
    expect(botReferralCode("alquilame")).toBe("vanesa-bot");
    expect(botReferralCode("alquicarros")).toBe("elisa-bot");
  });

  it("returns undefined for an unknown brand (no attribution)", () => {
    expect(botReferralCode("otra-marca")).toBeUndefined();
    expect(botReferralCode("")).toBeUndefined();
  });
});
