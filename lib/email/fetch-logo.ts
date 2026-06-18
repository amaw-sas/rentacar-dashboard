// Resend Node.js SDK v6.12.2 attachment shape (verified at
// node_modules/resend/dist/index.cjs:208): the SDK reads
// `attachment.contentId` and emits `content_id` in the API request.
// We fetch server-side to control SSRF surface, then pass the Buffer to
// the SDK with `contentId`. The public Context7 docs showed both `cid`
// and `contentId` patterns from different SDK versions; the installed
// SDK source is authoritative. See
// docs/specs/2026-05-19-issue-9-email-spam-fix/context7-finding.md
// (retracted) for the full history.

const FETCH_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 100_000;
// 100 bytes is below any plausible PNG/JPEG/GIF/WebP header+payload. Catches
// empty bodies (CDN cache miss, mid-delete) and truncated downloads — both
// would ship a broken-image attachment, defeating the spam fix.
const MIN_LOGO_BYTES = 100;
const ALLOWED_PREFIXES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Exact match OR dot-boundary suffix. Plain endsWith would let
// `evil-alquilatucarro.com` slip through.
const ALLOWED_HOSTS = [
  "public.blob.vercel-storage.com",
  "alquilatucarro.com",
  "alquilame.co",
  "alquicarros.com",
];

export interface LogoAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith("." + h)
  );
}

export async function fetchLogoAttachment(
  logoUrl: string | null | undefined
): Promise<LogoAttachment | null> {
  if (!logoUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    console.warn(`[email] logo url unparseable: ${logoUrl}`);
    return null;
  }
  if (parsed.protocol !== "https:") {
    console.warn(`[email] logo non-https rejected: ${logoUrl}`);
    return null;
  }
  if (!isAllowedHost(parsed.hostname)) {
    console.warn(`[email] logo host not allowed: ${parsed.hostname}`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // `redirect: "manual"` blocks SSRF-via-redirect: the allowlist only
    // validates the initial URL. Without this, an allowlisted host serving
    // a 3xx to an internal target would bypass the allowlist.
    const res = await fetch(logoUrl, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      console.warn(`[email] logo fetch redirect ${res.status}: ${logoUrl}`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[email] logo fetch ${res.status}: ${logoUrl}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!ALLOWED_PREFIXES.some((p) => contentType.startsWith(p))) {
      console.warn(
        `[email] logo content-type "${contentType}" rejected: ${logoUrl}`
      );
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < MIN_LOGO_BYTES || buf.byteLength > MAX_LOGO_BYTES) {
      console.warn(
        `[email] logo size out of range (${buf.byteLength} bytes; allowed ${MIN_LOGO_BYTES}-${MAX_LOGO_BYTES}): ${logoUrl}`
      );
      return null;
    }
    const ext = contentType.split("/")[1].split(";")[0].trim();
    return { filename: `logo.${ext}`, content: buf, contentType };
  } catch (err) {
    console.warn(`[email] logo fetch failed: ${logoUrl}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
