import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clientIpFromHeaders, hashClientIp } from "@/lib/chat/client-ip";

describe("clientIpFromHeaders", () => {
  it("takes the first entry of x-forwarded-for and trims it", () => {
    const h = new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8 " });
    expect(clientIpFromHeaders(h)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "9.9.9.9" });
    expect(clientIpFromHeaders(h)).toBe("9.9.9.9");
  });

  it("returns null when no IP headers are present", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("hashClientIp", () => {
  beforeEach(() => {
    delete process.env.CHAT_IP_HASH_SALT;
  });
  afterEach(() => {
    delete process.env.CHAT_IP_HASH_SALT;
  });

  it("returns null when no salt is configured (per-IP limits disabled)", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(hashClientIp(h)).toBeNull();
  });

  it("returns null when there is a salt but no IP", () => {
    process.env.CHAT_IP_HASH_SALT = "s";
    expect(hashClientIp(new Headers())).toBeNull();
  });

  it("hashes deterministically and never returns the raw IP", () => {
    process.env.CHAT_IP_HASH_SALT = "s";
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    const a = hashClientIp(h);
    const b = hashClientIp(h);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(a).not.toContain("1.2.3.4");
  });

  it("yields different hashes for different IPs and different salts", () => {
    process.env.CHAT_IP_HASH_SALT = "s1";
    const a = hashClientIp(new Headers({ "x-real-ip": "1.1.1.1" }));
    const b = hashClientIp(new Headers({ "x-real-ip": "2.2.2.2" }));
    expect(a).not.toBe(b);
    process.env.CHAT_IP_HASH_SALT = "s2";
    const c = hashClientIp(new Headers({ "x-real-ip": "1.1.1.1" }));
    expect(c).not.toBe(a);
  });
});
