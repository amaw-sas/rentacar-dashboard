import { describe, it, expect, afterEach } from "vitest";
import { safeReturnTo, getReturnTo } from "@/lib/navigation/return-to";

describe("safeReturnTo", () => {
  const fallback = "/reservations";

  describe("absent values fall back", () => {
    it("returns fallback for null", () => {
      expect(safeReturnTo(null, fallback)).toBe(fallback);
    });

    it("returns fallback for undefined", () => {
      expect(safeReturnTo(undefined, fallback)).toBe(fallback);
    });

    it("returns fallback for empty string", () => {
      expect(safeReturnTo("", fallback)).toBe(fallback);
    });
  });

  describe("open-redirect guard rejects hostile values", () => {
    it("returns fallback for protocol-relative '//evil.com'", () => {
      expect(safeReturnTo("//evil.com", fallback)).toBe(fallback);
    });

    it("returns fallback for absolute 'https://evil.com'", () => {
      expect(safeReturnTo("https://evil.com", fallback)).toBe(fallback);
    });

    it("returns fallback for a different listing '/customers'", () => {
      expect(safeReturnTo("/customers", fallback)).toBe(fallback);
    });

    it("returns fallback when the value contains a backslash", () => {
      expect(safeReturnTo("/reservations\\@evil.com", fallback)).toBe(fallback);
    });
  });

  describe("does NOT trim — whitespace-prefixed values are rejected", () => {
    it("returns fallback for a leading-space value (not trimmed)", () => {
      expect(safeReturnTo(" /reservations", fallback)).toBe(fallback);
    });

    it("returns fallback for a leading-tab value (not trimmed)", () => {
      expect(safeReturnTo("\t/reservations", fallback)).toBe(fallback);
    });

    it("returns fallback for a leading-newline value (not trimmed)", () => {
      expect(safeReturnTo("\n/reservations", fallback)).toBe(fallback);
    });
  });

  describe("valid same-listing values are returned verbatim", () => {
    it("returns the path when it equals the fallback exactly", () => {
      expect(safeReturnTo("/reservations", fallback)).toBe("/reservations");
    });

    it("returns the path with query string verbatim", () => {
      expect(safeReturnTo("/reservations?status=nueva&page=2", fallback)).toBe(
        "/reservations?status=nueva&page=2",
      );
    });
  });
});

describe("getReturnTo", () => {
  const fallback = "/reservations";

  function stubSearch(search: string) {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search },
    });
  }

  afterEach(() => {
    stubSearch("");
  });

  it("returns the safe filtered listing when ?from= is present", () => {
    stubSearch(`?from=${encodeURIComponent("/reservations?status=nueva&page=2")}`);
    expect(getReturnTo(fallback)).toBe("/reservations?status=nueva&page=2");
  });

  it("falls back when ?from= is absent", () => {
    stubSearch("");
    expect(getReturnTo(fallback)).toBe(fallback);
  });

  it("falls back when ?from= is hostile (off-site)", () => {
    stubSearch(`?from=${encodeURIComponent("https://evil.com")}`);
    expect(getReturnTo(fallback)).toBe(fallback);
  });

  it("falls back when ?from= points at a different listing", () => {
    stubSearch(`?from=${encodeURIComponent("/customers?q=lopez")}`);
    expect(getReturnTo(fallback)).toBe(fallback);
  });
});
