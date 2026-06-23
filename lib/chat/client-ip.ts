import { createHash } from "node:crypto";

/**
 * Client-IP handling for the public chat endpoint's anti-abuse layer.
 *
 * We NEVER store the raw IP (PII minimization). Instead we derive a salted
 * SHA-256 so the dashboard/rate-limit code can count per-IP without ever holding
 * an address. The salt lives in CHAT_IP_HASH_SALT; without it we cannot produce a
 * stable, non-reversible hash, so we DEGRADE GRACEFULLY: return null and skip the
 * per-IP limits rather than store a weakly-salted value or break the request.
 */

/**
 * Best-effort client IP from the proxy headers Vercel sets. `x-forwarded-for` is
 * a comma list (client first, then proxies) — take the first. Falls back to
 * `x-real-ip`. Returns null when neither is present (e.g., local tests).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * Salted SHA-256 of the client IP, or null when we can't/shouldn't compute it
 * (no IP, or no salt configured). Callers treat null as "skip per-IP limits".
 */
export function hashClientIp(headers: Headers): string | null {
  const salt = process.env.CHAT_IP_HASH_SALT;
  if (!salt) {
    console.warn("[chat] CHAT_IP_HASH_SALT not set — per-IP limits disabled");
    return null;
  }
  const ip = clientIpFromHeaders(headers);
  if (!ip) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
