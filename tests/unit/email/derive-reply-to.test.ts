import { describe, it, expect } from "vitest";
import { deriveReplyTo } from "@/lib/email/send";

describe("deriveReplyTo", () => {
  // SCEN-011: Reply-To preserva plus addressing
  it("preserves plus addressing while stripping mail. subdomain", () => {
    expect(deriveReplyTo("info+marketing@mail.alquilatucarro.com")).toBe(
      "info+marketing@alquilatucarro.com"
    );
  });

  // SCEN-012: deriveReplyTo cubre boundary cases
  it("returns null unchanged", () => {
    expect(deriveReplyTo(null)).toBeNull();
  });

  it("returns undefined unchanged", () => {
    expect(deriveReplyTo(undefined)).toBeUndefined();
  });

  it("is idempotent when no mail. prefix exists (apex unchanged)", () => {
    expect(deriveReplyTo("info@alquilatucarro.com")).toBe(
      "info@alquilatucarro.com"
    );
  });

  it("strips mail. case-insensitively", () => {
    expect(deriveReplyTo("info@MAIL.alquilatucarro.com")).toBe(
      "info@alquilatucarro.com"
    );
    expect(deriveReplyTo("info@Mail.alquilatucarro.com")).toBe(
      "info@alquilatucarro.com"
    );
  });

  it("does not corrupt domains that contain 'mail' as non-leading substring", () => {
    expect(deriveReplyTo("info@email.com")).toBe("info@email.com");
    expect(deriveReplyTo("user@mailcorp.com")).toBe("user@mailcorp.com");
  });

  it("strips only the leading mail. for multi-TLD domains", () => {
    expect(deriveReplyTo("info@mail.example.co.uk")).toBe(
      "info@example.co.uk"
    );
  });

  it("returns input unchanged when no @ is present (defensive)", () => {
    expect(deriveReplyTo("info")).toBe("info");
  });

  it("returns input unchanged for empty string", () => {
    expect(deriveReplyTo("")).toBe("");
  });

  it("strips standard subdomain case (sanity check)", () => {
    expect(deriveReplyTo("info@mail.alquilatucarro.com")).toBe(
      "info@alquilatucarro.com"
    );
  });
});
