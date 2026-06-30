import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidPhone,
  isValidIdentification,
  normalizeIdentification,
  isValidFullname,
  validateCustomerData,
  type CustomerData,
} from "@/lib/chat/customer-validation";

describe("field validators", () => {
  it("email accepts real addresses and rejects junk", () => {
    expect(isValidEmail("diego@correo.com")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("no-arroba")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });

  it("phone accepts 7–15 digits (with cosmetic separators) and rejects junk", () => {
    expect(isValidPhone("3001234567")).toBe(true);
    expect(isValidPhone("+57 300 123 4567")).toBe(true);
    expect(isValidPhone("(601) 123-4567")).toBe(true);
    expect(isValidPhone("300")).toBe(false);
    expect(isValidPhone("abc")).toBe(false);
    expect(isValidPhone("1234567890123456")).toBe(false); // 16 digits
  });

  it("identification validates by document type", () => {
    expect(isValidIdentification("CC", "1234567890")).toBe(true);
    expect(isValidIdentification("CE", "123456")).toBe(true);
    expect(isValidIdentification("CC", "1")).toBe(false);
    expect(isValidIdentification("CC", "12ab56")).toBe(false);
    expect(isValidIdentification("PA", "AB123456")).toBe(true);
    expect(isValidIdentification("PA", "ab")).toBe(false);
  });

  it("accepts cédulas written with thousands separators or spaces (the loop bug)", () => {
    // Colombians write IDs with dots; the strict /^\d{6,10}$/ rejected these and the bot
    // looped "el número no parece válido" forever, blocking real bookings.
    expect(isValidIdentification("CC", "1.045.223.117")).toBe(true);
    expect(isValidIdentification("CC", "71.345.876")).toBe(true);
    expect(isValidIdentification("CC", "71 345 876")).toBe(true);
    expect(normalizeIdentification("CC", "1.045.223.117")).toBe("1045223117");
    expect(normalizeIdentification("CC", "71.345.876")).toBe("71345876");
    // PA keeps its alphanumeric form (only trimmed).
    expect(normalizeIdentification("PA", " AB123456 ")).toBe("AB123456");
    // Still rejects junk (too short after stripping non-digits).
    expect(isValidIdentification("CC", "12.3")).toBe(false);
  });

  it("fullname requires real letters, not just digits/symbols", () => {
    expect(isValidFullname("Diego Melo")).toBe(true);
    expect(isValidFullname("123")).toBe(false);
    expect(isValidFullname("-")).toBe(false);
  });
});

describe("validateCustomerData", () => {
  const valid: CustomerData = {
    fullname: "Diego Melo",
    identification_type: "CC",
    identification: "1234567890",
    email: "diego@correo.com",
    phone: "3001234567",
  };

  it("passes a complete valid customer", () => {
    expect(validateCustomerData(valid)).toEqual({ ok: true });
  });

  it("returns a friendly ES error for a bad phone", () => {
    const r = validateCustomerData({ ...valid, phone: "300" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/teléfono/i);
  });

  it("returns a friendly ES error for a bad email", () => {
    const r = validateCustomerData({ ...valid, email: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/correo/i);
  });

  it("returns a friendly ES error for a bad document", () => {
    const r = validateCustomerData({ ...valid, identification: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/documento/i);
  });
});
