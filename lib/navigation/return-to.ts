/**
 * Open-redirect guard for the post-save redirect.
 *
 * `from` is attacker-controllable (it arrives as a URL query param), so it is
 * only honored when it is a root-relative path that points at the same listing
 * as `fallback`. Anything else returns `fallback`.
 *
 * The value is deliberately NOT trimmed: a leading space/tab/newline fails the
 * `startsWith("/")` check and is rejected. Trimming would let a crafted
 * whitespace prefix slip a hostile target past the guard.
 *
 * Rejected: empty/absent, protocol-relative (`//evil.com`), absolute
 * (`https://evil.com`), values containing a backslash (browsers may treat `\`
 * as `/`), and paths whose base (before `?`) differs from `fallback`.
 *
 * @param from     candidate return path from the `?from=` query param
 * @param fallback the entity's own listing path (e.g. `/reservations`)
 * @returns `from` verbatim when safe, otherwise `fallback`
 */
export function safeReturnTo(
  from: string | null | undefined,
  fallback: string,
): string {
  if (!from) return fallback;
  if (!from.startsWith("/") || from.startsWith("//") || from.includes("\\")) {
    return fallback;
  }
  if (from.split("?")[0] !== fallback) return fallback;
  return from;
}

/**
 * Client-only reader for the post-save redirect target.
 *
 * Reads the `?from=` param written by `ReturnLink` off the live address bar and
 * resolves it through {@link safeReturnTo}. Centralizes the one piece of browser
 * coupling the forms would otherwise duplicate. Call only from a client event
 * handler (it touches `window`), never during render.
 *
 * @param fallback the entity's own listing path (e.g. `/reservations`)
 * @returns the guarded return path — the filtered listing when `from` is safe,
 *          otherwise `fallback`
 */
export function getReturnTo(fallback: string): string {
  const from = new URLSearchParams(window.location.search).get("from");
  return safeReturnTo(from, fallback);
}
