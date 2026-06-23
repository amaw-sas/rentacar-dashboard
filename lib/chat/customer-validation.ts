/**
 * Lightweight server-side validation of the customer data BEFORE a booking
 * (Inc. 4 "Escudo"). The model already collects these fields, but a public,
 * anonymous endpoint can be fed junk to create fake reservations — so we hard
 * validate the FORMAT here, on the server, before calling `crear_reserva`. On a
 * failure the agent relays the (friendly, ES) message verbatim and re-asks the
 * customer, matching the existing error-relay pattern. This is format-only
 * friction, not identity verification (no OTP/SMS — out of scope, anonymous flow).
 */

export interface CustomerData {
  fullname: string;
  identification_type: string;
  identification: string;
  email: string;
  phone: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Pragmatic email shape: non-space local + @ + domain with a dot. Not RFC-perfect
// on purpose — the goal is to reject obvious junk, not to police valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits only, after stripping the cosmetic separators people type in phones. */
function phoneDigits(phone: string): string {
  return phone.replace(/[\s()+.-]/g, "");
}

export function isValidFullname(fullname: string): boolean {
  // At least two characters that aren't digits/symbols — a real name, not "123".
  return /\p{L}{2,}/u.test(fullname.trim());
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Phone: digits only after cleanup, 7–15 long (Colombian landline is 7, mobile is
 * 10, with country code up to ~13; 15 is the E.164 ceiling). Blocks "300"-style junk.
 */
export function isValidPhone(phone: string): boolean {
  const digits = phoneDigits(phone);
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Identification by type. CC/CE are numeric (6–10 digits in Colombia); PA
 * (passport) is alphanumeric (5–15). Unknown types fall back to a lenient
 * alphanumeric check so we never block a valid-but-unexpected document.
 */
export function isValidIdentification(type: string, id: string): boolean {
  const t = type.trim().toUpperCase();
  const value = id.trim();
  if (t === "CC" || t === "CE") return /^\d{6,10}$/.test(value);
  if (t === "PA") return /^[A-Za-z0-9]{5,15}$/.test(value);
  return /^[A-Za-z0-9]{4,20}$/.test(value);
}

/**
 * Validate all fields, returning the FIRST friendly ES error so the bot re-asks
 * for exactly one thing. `ok` means every field passed the format check.
 */
export function validateCustomerData(data: CustomerData): ValidationResult {
  if (!isValidFullname(data.fullname)) {
    return { ok: false, error: "El nombre no parece válido, ¿me confirmas tu nombre completo?" };
  }
  if (!isValidIdentification(data.identification_type, data.identification)) {
    return {
      ok: false,
      error: "El número de documento no parece válido, ¿me lo confirmas?",
    };
  }
  if (!isValidEmail(data.email)) {
    return { ok: false, error: "El correo no parece válido, ¿me lo confirmas?" };
  }
  if (!isValidPhone(data.phone)) {
    return { ok: false, error: "El teléfono no parece válido, ¿me confirmas tu número?" };
  }
  return { ok: true };
}
